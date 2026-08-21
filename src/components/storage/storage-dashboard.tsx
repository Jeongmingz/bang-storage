"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckIcon,
  FileUpIcon,
  FilesIcon,
  FolderIcon,
  FolderPlusIcon,
  LayoutGridIcon,
  ListIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import {
  createFolderAction,
  createUploadUrl,
  deleteFilesAction,
  deleteFolderAction,
  generateDownloadLink,
  listFoldersAction,
  moveFilesAction,
  logout,
  refreshFiles,
  renameFileAction,
  searchFilesAction,
} from "@/app/actions";
import type { SearchResult, StorageFile, StorageSnapshot } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { FileIcon, defaultStyles } from "react-file-icon";

type Props = {
  initialSnapshot: StorageSnapshot;
  bucketName: string;
};

type RelativeFile = File & { webkitRelativePath?: string };
type TableItem =
  | { kind: "folder"; id: string; name: string; path: string; isParent?: boolean }
  | { kind: "file"; id: string; file: StorageFile };

function formatSize(size: number) {
  if (size === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const value = size / 1024 ** index;
  return `${value.toFixed(value > 10 ? 1 : 2)} ${units[index]}`;
}

function formatRelative(date: string) {
  const target = new Date(date);
  const diff = target.getTime() - Date.now();
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 60) {
    return `${Math.abs(minutes)}분 ${minutes >= 0 ? "후" : "전"}`;
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return `${Math.abs(hours)}시간 ${hours >= 0 ? "후" : "전"}`;
  }
  const days = Math.round(hours / 24);
  return `${Math.abs(days)}일 ${days >= 0 ? "후" : "전"}`;
}

const DEFAULT_FOLDER = "";
const MAX_CONCURRENT_UPLOADS = 4;
// Mirrors MAX_UPLOAD_SIZE_BYTES in src/lib/storage.ts (kept separate — that module is server-only).
const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024 * 1024;

async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  limit: number,
): Promise<PromiseSettledResult<void>[]> {
  const results: PromiseSettledResult<void>[] = new Array(items.length);
  let cursor = 0;

  const runNext = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        await worker(items[index]);
        results[index] = { status: "fulfilled", value: undefined };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

export function StorageDashboard({ initialSnapshot, bucketName }: Props) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [, setBucket] = useState(bucketName);
  const [currentFolder, setCurrentFolder] = useState(initialSnapshot.path ?? DEFAULT_FOLDER);
  const [rootFolders, setRootFolders] = useState<string[]>(
    initialSnapshot.path ? [] : initialSnapshot.folders,
  );
  const [isUploading, setIsUploading] = useState(false);
  const [isMutating, startMutate] = useTransition();
  const [, startRefreshing] = useTransition();
  const [progress, setProgress] = useState(0);
  type UploadStatus = "pending" | "uploading" | "success" | "error";
  type UploadItem = { id: string; name: string; size: number; progress: number; status: UploadStatus };
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [newFolder, setNewFolder] = useState("");
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
  const [availableFolders, setAvailableFolders] = useState<string[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [isFoldersLoading, setIsFoldersLoading] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<StorageFile | null>(null);
  const [renameTarget, setRenameTarget] = useState<StorageFile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [, setQuickUploadMode] = useState<"file" | "folder" | null>(null);
  const [fileUrls, setFileUrls] = useState<Record<string, { url: string; expiresAt: number }>>({});
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const files = snapshot.files;
  const folders = snapshot.folders;
  const visibleFolders = folders.filter((folder) => !folder.startsWith(".keep"));
  const trimmedQuery = searchQuery.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();
  const isSearchMode = normalizedQuery.length > 0;
  const visibleFiles = files;
  const displayFileCountLabel = `${visibleFiles.length}`;
  const searchSummary = isSearchMode
    ? isSearching
      ? "검색하는 중..."
      : `"${trimmedQuery}" 검색 결과 ${searchResults.length}개`
    : "파일 이름으로 전체 폴더를 검색할 수 있어요.";

  const handleUnauthorized = useCallback(
    (message: string) => {
      if (message.includes("세션")) {
        router.refresh();
      }
    },
    [router],
  );

  useEffect(() => {
    if (!normalizedQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(() => {
      searchFilesAction(normalizedQuery).then((result) => {
        if (cancelled) return;
        if (result.success) {
          setSearchResults(result.results);
        } else {
          toast.error(result.message);
          handleUnauthorized(result.message);
        }
        setIsSearching(false);
      });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalizedQuery, handleUnauthorized]);

  const handleSnapshotUpdate = (next: StorageSnapshot, nextBucket?: string) => {
    setSnapshot(next);
    setCurrentFolder(next.path ?? DEFAULT_FOLDER);
    if (!next.path) {
      setRootFolders(next.folders);
    }
    if (nextBucket) {
      setBucket(nextBucket);
    }
  };

  const handleFileSelectionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = Array.from(event.target.files ?? []);
    const files = rawFiles.filter((file) => file.size > 0);
    if (files.length > 0) {
      uploadFilesWithMode(files, false).finally(() => {
        setQuickUploadMode(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      });
    } else {
      setQuickUploadMode(null);
    }
  };

  const handleFolderSelectionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = Array.from(event.target.files ?? []);
    const files = rawFiles.filter((file) => file.size > 0);
    if (files.length > 0) {
      uploadFilesWithMode(files, true).finally(() => {
        setQuickUploadMode(null);
        if (folderInputRef.current) folderInputRef.current.value = "";
      });
    } else {
      setQuickUploadMode(null);
    }
  };

  const updateUploadItem = (uploadId: string, partial: Partial<UploadItem>) => {
    setUploadItems((prev) => prev.map((item) => (item.id === uploadId ? { ...item, ...partial } : item)));
  };

  const uploadFilesWithMode = async (files: File[], useRelativePaths: boolean) => {
    if (files.length === 0) {
      toast.error("업로드할 파일을 선택하세요.");
      return;
    }

    const oversized = files.filter((file) => file.size > MAX_UPLOAD_SIZE_BYTES);
    const uploadable = files.filter((file) => file.size <= MAX_UPLOAD_SIZE_BYTES);
    if (oversized.length > 0) {
      toast.error(`${oversized.length}개 파일이 5GB를 초과해 제외되었습니다.`);
    }
    if (uploadable.length === 0) {
      return;
    }
    files = uploadable;

    setIsUploading(true);
    setProgress(0);
    const uploadDescriptor = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      file: file as RelativeFile,
    }));
    setUploadItems(
      uploadDescriptor.map(({ id, file }) => ({
        id,
        name: file.name,
        size: file.size,
        progress: 0,
        status: "pending" as UploadStatus,
      })),
    );

    const uploadSingleFile = async (entry: { id: string; file: RelativeFile }) => {
      const { id, file } = entry;
      updateUploadItem(id, { status: "uploading", progress: 0 });
      const payload = new FormData();
        payload.set("fileName", file.name);
        payload.set("fileSize", String(file.size));
        const relativeFolder = useRelativePaths
          ? deriveRelativeFolder(currentFolder ?? "", file.webkitRelativePath)
          : currentFolder || undefined;
        if (relativeFolder) payload.set("folder", relativeFolder);
        if (file.type) payload.set("contentType", file.type);

      const uploadTarget = await createUploadUrl(payload);
      if (!uploadTarget.success || !uploadTarget.uploadUrl) {
        updateUploadItem(id, { status: "error" });
        throw new Error(uploadTarget.message ?? "업로드 URL을 만들지 못했습니다.");
      }

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadTarget.uploadUrl);
        if (file.type) {
          xhr.setRequestHeader("Content-Type", file.type);
        }
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            updateUploadItem(id, { progress: percent });
            setProgress(percent);
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            updateUploadItem(id, { progress: 100, status: "success" });
            resolve();
          } else {
            updateUploadItem(id, { status: "error" });
            reject(new Error("업로드 중 오류가 발생했습니다."));
          }
        };
        xhr.onerror = () => {
          updateUploadItem(id, { status: "error" });
          reject(new Error("업로드 중 오류가 발생했습니다."));
        };
        xhr.send(file);
      });
    };

    try {
      const uploadResults = await runWithConcurrency(uploadDescriptor, uploadSingleFile, MAX_CONCURRENT_UPLOADS);
      const hasFailure = uploadResults.some((result) => result.status === "rejected");
      const refreshed = await refreshFiles(currentFolder);
      if (refreshed.success && refreshed.snapshot) {
        handleSnapshotUpdate(refreshed.snapshot, refreshed.bucket);
        if (hasFailure) {
          toast.error("일부 파일 업로드에 실패했습니다.");
        } else {
          toast.success(`${files.length}개의 파일을 업로드했습니다.`);
        }
      } else if (!refreshed.success) {
        toast.error(refreshed.message);
        handleUnauthorized(refreshed.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "업로드 중 오류가 발생했습니다.");
    } finally {
      setIsUploading(false);
      setProgress(0);
      setUploadItems([]);
    }
  };

  const handleQuickPick = (mode: "file" | "folder") => {
    if (isUploading) return;
    setQuickUploadMode(mode);
    if (mode === "file") {
      fileInputRef.current?.click();
    } else {
      folderInputRef.current?.click();
    }
  };

  const getCachedUrl = useCallback(
    (file: StorageFile) => {
      const record = fileUrls[file.id];
      if (!record) return null;
      if (record.expiresAt > Date.now()) return record.url;
      return null;
    },
    [fileUrls],
  );

  const fetchDownloadUrl = useCallback(
    async (file: StorageFile) => {
      const cached = getCachedUrl(file);
      if (cached) return cached;

      const result = await generateDownloadLink(file.path);
      if (result.success && result.url) {
        setFileUrls((prev) => ({
          ...prev,
          [file.id]: {
            url: result.url,
            expiresAt: Date.now() + 4 * 60 * 1000,
          },
        }));
        return result.url;
      }
      if (!result.success) {
        toast.error(result.message);
        handleUnauthorized(result.message);
      }
      return null;
    },
    [getCachedUrl, handleUnauthorized],
  );

  const handleGenerateLink = (file: StorageFile, copyToClipboard = false, forceDownload = false) => {
    startMutate(() => {
      fetchDownloadUrl(file).then(async (url) => {
        if (!url) return;
        if (copyToClipboard) {
          await navigator.clipboard.writeText(url);
          toast.success("링크를 복사했습니다.");
        } else if (forceDownload) {
          try {
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = blobUrl;
            anchor.download = file.name;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(blobUrl);
            toast.success("다운로드를 시작했어요.");
          } catch {
            toast.error("다운로드 중 문제가 발생했습니다.");
          }
        } else {
          window.open(url, "_blank");
        }
      });
    });
  };

  useEffect(() => {
    if (previewFile && getPreviewType(previewFile)) {
      fetchDownloadUrl(previewFile);
    }
  }, [previewFile, fetchDownloadUrl]);

  useEffect(() => {
    setSelectedFileIds(new Set());
  }, [currentFolder]);

  const getPreviewUrl = (file: StorageFile) => {
    if (!getPreviewType(file)) return null;
    return getCachedUrl(file);
  };

  const selectedFiles = useMemo(() => files.filter((file) => selectedFileIds.has(file.id)), [files, selectedFileIds]);
  const selectedCount = selectedFiles.length;
  const allSelected = visibleFiles.length > 0 && visibleFiles.every((file) => selectedFileIds.has(file.id));
  const previewKind = previewFile ? getPreviewType(previewFile) : null;
  const previewLink = previewFile && previewKind ? getPreviewUrl(previewFile) : null;

  const toggleFileSelection = (fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedFileIds((prev) => {
      if (visibleFiles.length === 0) return new Set(prev);
      const next = new Set(prev);
      const everySelected = visibleFiles.every((file) => next.has(file.id));
      if (everySelected) {
        visibleFiles.forEach((file) => next.delete(file.id));
      } else {
        visibleFiles.forEach((file) => next.add(file.id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedFileIds(new Set());

  const handleOpenMoveDialog = () => {
    if (selectedCount === 0) {
      toast.error("이동할 파일을 선택하세요.");
      return;
    }
    setMoveTarget(currentFolder || "");
    setIsMoveDialogOpen(true);
    if (!foldersLoaded) {
      loadFolders();
    }
  };

  const handleMoveSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedFiles.length === 0) {
      toast.error("이동할 파일을 선택하세요.");
      return;
    }
    if (moveTarget === null) {
      toast.error("이동할 폴더를 선택하세요.");
      return;
    }
    const destination = moveTarget;
    if (destination === (currentFolder || "")) {
      toast.error("다른 폴더를 선택하세요.");
      return;
    }

    const paths = selectedFiles.map((file) => file.path);

    startMutate(() => {
      moveFilesAction(paths, destination, currentFolder).then((result) => {
        if (result.success && result.snapshot) {
          handleSnapshotUpdate(result.snapshot);
          toast.success("파일을 이동했습니다.");
          clearSelection();
          setIsMoveDialogOpen(false);
          setMoveTarget(null);
        } else if (!result.success) {
          toast.error(result.message);
          handleUnauthorized(result.message);
        }
      });
    });
  };

  const handleBulkDelete = () => {
    if (selectedFiles.length === 0) {
      toast.error("삭제할 파일을 선택하세요.");
      return;
    }
    startMutate(() => {
      deleteFilesAction(selectedFiles.map((file) => file.path), currentFolder).then((result) => {
        if (result.success && result.snapshot) {
          handleSnapshotUpdate(result.snapshot);
          toast.success(`${selectedFiles.length}개의 파일을 삭제했습니다.`);
          clearSelection();
        } else if (!result.success) {
          toast.error(result.message);
          handleUnauthorized(result.message);
        }
      });
    });
  };

  const handleBulkDownload = () => {
    if (selectedFiles.length === 0) {
      toast.error("다운로드할 파일을 선택하세요.");
      return;
    }

    startMutate(() => {
      Promise.all(selectedFiles.map((file) => fetchDownloadUrl(file))).then((urls) => {
        const opened = urls.filter(Boolean) as string[];
        opened.forEach((url) => window.open(url, "_blank"));
        if (opened.length > 0) {
          toast.success(`${opened.length}개의 링크를 열었어요.`);
        }
      });
    });
  };

  const handleRefresh = (folder?: string, showToast = true) => {
    startRefreshing(() => {
      refreshFiles(folder).then((result) => {
        if (result.success && result.snapshot) {
          handleSnapshotUpdate(result.snapshot, result.bucket);
          if (showToast) toast.success("새로고침 완료");
        } else if (!result.success) {
          toast.error(result.message);
          handleUnauthorized(result.message);
        }
      });
    });
  };

  const handleSearchResultClick = (result: SearchResult) => {
    setSearchQuery("");
    handleRefresh(result.folder, false);
    setPreviewFile(result);
  };

  const handleLogout = () => {
    startMutate(() => {
      logout().then((result) => {
        toast.success(result.message ?? "로그아웃했습니다.");
        router.refresh();
      });
    });
  };

  const handleCreateFolder = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newFolder.trim()) return;
    const formData = new FormData();
    formData.set("name", newFolder.trim());
    if (currentFolder) {
      formData.set("parent", currentFolder);
    }

    startMutate(() => {
      createFolderAction(formData).then((result) => {
        if (result.success && result.snapshot) {
          handleSnapshotUpdate(result.snapshot);
          toast.success("폴더를 만들었어요.");
          setNewFolder("");
          setIsFolderDialogOpen(false);
        } else if (!result.success) {
          toast.error(result.message);
          handleUnauthorized(result.message);
        }
      });
    });
  };

  const handleDeleteFolder = (folderPath: string) => {
    startMutate(() => {
      deleteFolderAction(folderPath).then((result) => {
        if (result.success && result.snapshot) {
          handleSnapshotUpdate(result.snapshot);
          toast.success("폴더를 삭제했습니다.");
        } else if (!result.success) {
          toast.error(result.message);
          handleUnauthorized(result.message);
        }
      });
    });
  };

  const handleRenameSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameTarget) return;
    startMutate(() => {
      renameFileAction(renameTarget.path, renameValue, currentFolder).then((result) => {
        if (result.success && result.snapshot) {
          handleSnapshotUpdate(result.snapshot);
          toast.success("이름을 변경했습니다.");
          setRenameTarget(null);
          setRenameValue("");
        } else if (!result.success) {
          toast.error(result.message);
          handleUnauthorized(result.message);
        }
      });
    });
  };

  const isRoot = !currentFolder;
  const currentLabel = currentFolder || "루트";
  const composePath = useCallback(
    (folderName: string) =>
      (currentFolder ? `${currentFolder}/${folderName}` : folderName).replace(/\/+/, "/"),
    [currentFolder],
  );
  const parentPath = useMemo(() => {
    if (!currentFolder) return "";
    const segments = currentFolder.split("/").filter(Boolean);
    segments.pop();
    return segments.join("/");
  }, [currentFolder]);

  const breadcrumbSegments = useMemo(() => {
    if (!currentFolder) return [];
    const segments = currentFolder.split("/").filter(Boolean);
    let path = "";
    return segments.map((segment) => {
      path = path ? `${path}/${segment}` : segment;
      return { label: segment, path };
    });
  }, [currentFolder]);

  const tableItems = useMemo<TableItem[]>(() => {
    const parentItem = !isRoot
      ? [{ kind: "folder" as const, id: "folder-parent", name: "..", path: parentPath, isParent: true }]
      : [];
    const folderItems = visibleFolders.map((folder) => ({
      kind: "folder" as const,
      id: `folder-${folder}`,
      name: folder,
      path: composePath(folder),
    }));
    const fileItems = visibleFiles.map((file) => ({
      kind: "file" as const,
      id: file.id,
      file,
    }));
    return [...parentItem, ...folderItems, ...fileItems];
  }, [visibleFolders, visibleFiles, isRoot, parentPath, composePath]);

  const showEmptyState = visibleFolders.length === 0 && visibleFiles.length === 0;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) return;
      if (key === "f" || key === "k") {
        event.preventDefault();
        setIsCommandOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  useEffect(() => {
    const shouldLock = isCommandOpen || isFolderDialogOpen || Boolean(previewFile) || isMoveDialogOpen;
    const html = document.documentElement;
    const body = document.body;
    const previousHtml = html.style.overflow;
    const previousBody = body.style.overflow;

    if (shouldLock) {
      html.style.overflow = "hidden";
      body.style.overflow = "hidden";
    } else {
      html.style.overflow = "";
      body.style.overflow = "";
    }

    return () => {
      html.style.overflow = previousHtml;
      body.style.overflow = previousBody;
    };
  }, [isCommandOpen, isFolderDialogOpen, isMoveDialogOpen, previewFile]);

  useEffect(() => {
    document.title = `Bang Storage - ${currentLabel}`;
  }, [currentLabel]);

  const loadFolders = useCallback(() => {
    setIsFoldersLoading(true);
    listFoldersAction()
      .then((result) => {
        if (result.success) {
          setAvailableFolders(result.folders);
          setFoldersLoaded(true);
        } else {
          toast.error(result.message);
        }
      })
      .catch(() => {
        toast.error("폴더 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        setIsFoldersLoading(false);
      });
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-56 flex-shrink-0 flex-col border-r border-border bg-sidebar sm:flex">
        <div className="flex items-center gap-2 px-3 py-3">
          <div className="flex size-6 items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background">
            B
          </div>
          <span className="text-sm font-semibold text-foreground">Bang Storage</span>
        </div>
        <button
          type="button"
          onClick={() => setIsCommandOpen(true)}
          className="mx-3 flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
        >
          <SearchIcon className="size-3.5" />
          검색
          <span className="ml-auto text-[10px]">⌘F</span>
        </button>
        <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-2">
          <button
            type="button"
            onClick={() => handleRefresh("", false)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              isRoot ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <FolderIcon className="size-4" /> 루트
          </button>
          <p className="mt-4 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">도구</p>
          <Link
            href="/pdf"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <FilesIcon className="size-4" /> PDF 합치기
          </Link>
          {rootFolders.filter((folder) => !folder.startsWith(".keep")).length > 0 && (
            <p className="mt-4 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">폴더</p>
          )}
          {rootFolders
            .filter((folder) => !folder.startsWith(".keep"))
            .map((folder) => (
              <button
                key={`sidebar-${folder}`}
                type="button"
                onClick={() => handleRefresh(folder, false)}
                className={cn(
                  "flex w-full items-center gap-2 truncate rounded-md px-2 py-1.5 text-sm",
                  currentFolder === folder
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <FolderIcon className="size-4 flex-shrink-0" />
                <span className="truncate">{folder}</span>
              </button>
            ))}
        </nav>
        <div className="border-t border-border p-2">
          <Button variant="ghost" onClick={handleLogout} className="w-full justify-start gap-2 text-muted-foreground">
            <LogOutIcon className="size-4" /> 로그아웃
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
          <span className="text-sm font-semibold text-foreground sm:hidden">Bang Storage</span>
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() => handleRefresh("", false)}
              className="flex-shrink-0 hover:text-foreground"
            >
              루트
            </button>
            {breadcrumbSegments.map((segment) => (
              <span key={segment.path} className="flex flex-shrink-0 items-center gap-1">
                <span className="text-border">/</span>
                <button
                  type="button"
                  onClick={() => handleRefresh(segment.path, false)}
                  className="hover:text-foreground"
                >
                  {segment.label}
                </button>
              </span>
            ))}
          </nav>
          <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="로그아웃" className="sm:hidden">
            <LogOutIcon className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" className="sm:hidden" render={<Link href="/pdf" />}>
            PDF
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
                {isSearchMode ? "검색 결과" : currentLabel}
              </h1>
              <p className="text-xs text-muted-foreground sm:text-sm">
                {isSearchMode ? `${searchResults.length}개 파일` : `파일 ${displayFileCountLabel}개`}
              </p>
            </div>
            {!isSearchMode && (
              <Button type="button" size="sm" className="gap-2" onClick={() => setIsFolderDialogOpen(true)}>
                <FolderPlusIcon className="size-4" /> 새 폴더
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">{searchSummary}</p>
            <div className="flex items-center gap-2">
              <div className="relative w-full sm:w-64">
                <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="전체 폴더에서 파일 검색"
                  className="pl-8"
                />
              </div>
              {!isSearchMode && (
                <div className="flex items-center rounded-md border border-border p-0.5">
                  <button
                    type="button"
                    onClick={() => setViewMode("list")}
                    aria-label="리스트 보기"
                    className={cn(
                      "flex size-7 items-center justify-center rounded-sm",
                      viewMode === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <ListIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("grid")}
                    aria-label="아이콘 보기"
                    className={cn(
                      "flex size-7 items-center justify-center rounded-sm",
                      viewMode === "grid" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <LayoutGridIcon className="size-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {!isSearchMode && (
            <>
                {selectedCount > 0 && (
                  <div className="mt-3 flex flex-wrap items-center justify-between rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground sm:text-sm">
                    <span>{selectedCount}개의 파일이 선택되었습니다.</span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={handleBulkDownload}>
                        다운로드
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleOpenMoveDialog}>
                        이동
                      </Button>
                      <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
                        삭제
                      </Button>
                      <Button size="sm" variant="ghost" onClick={clearSelection}>
                        해제
                      </Button>
                    </div>
                  </div>
                )}

                {viewMode === "list" && tableItems.length > 0 && (
                  <div className="mt-3 flex min-h-0 flex-1 rounded-lg border border-border bg-card">
                    <div className="max-h-[60vh] flex-1 overflow-y-auto">
                      <Table className="[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-card">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="sticky top-0 z-10 w-8 bg-card">
                              <input
                                type="checkbox"
                                aria-label="모두 선택"
                                checked={allSelected}
                                onChange={handleSelectAll}
                                className="size-4 accent-foreground"
                              />
                            </TableHead>
                            <TableHead className="sticky top-0 z-10 bg-card">이름</TableHead>
                            <TableHead className="sticky top-0 z-10 hidden bg-card md:table-cell">종류</TableHead>
                            <TableHead className="sticky top-0 z-10 hidden bg-card sm:table-cell">크기</TableHead>
                            <TableHead className="sticky top-0 z-10 bg-card">수정일</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {tableItems.map((item) => {
                        if (item.kind === "folder") {
                          const active = currentFolder === item.path;
                          return (
                            <TableRow
                              key={item.id}
                              className="cursor-pointer"
                              onClick={() => handleRefresh(item.path, false)}
                            >
                              <TableCell className="w-8 text-center text-[11px] text-muted-foreground">—</TableCell>
                              <TableCell>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-3">
                                    <div className={`flex h-9 w-9 items-center justify-center rounded-md border ${active ? "border-ring bg-accent" : "border-border bg-card"
                                      }`}>
                                      <FolderIcon className="size-4 text-muted-foreground" />
                                    </div>
                                    <div className="flex flex-col">
                                      <span className="text-sm font-semibold text-foreground">{item.name}</span>
                                      {item.isParent && (
                                        <span className="text-xs text-muted-foreground">상위 폴더로 이동</span>
                                      )}
                                    </div>
                                  </div>
                                  {!item.isParent && (
                                    <DropdownMenu>
                                      <DropdownMenuTrigger
                                        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent"
                                        onClick={(event) => event.stopPropagation()}
                                      >
                                        <MoreHorizontalIcon className="size-4" />
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                          className="text-destructive"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            handleDeleteFolder(item.path);
                                          }}
                                        >
                                          <Trash2Icon className="mr-2 size-4" /> 삭제
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="hidden text-xs text-muted-foreground md:table-cell">폴더</TableCell>
                              <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">—</TableCell>
                              <TableCell className="text-xs text-muted-foreground">—</TableCell>
                            </TableRow>
                          );
                        }
                        const file = item.file;
                        return (
                          <TableRow
                            key={file.id}
                            className="cursor-pointer"
                            onClick={() => setPreviewFile(file)}
                          >
                            <TableCell className="w-8">
                              <input
                                type="checkbox"
                                aria-label={`${file.name} 선택`}
                                checked={selectedFileIds.has(file.id)}
                                onChange={() => toggleFileSelection(file.id)}
                                onClick={(event) => event.stopPropagation()}
                                className="size-4 accent-foreground"
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <FileThumbnail
                                  file={file}
                                  getCachedUrl={getCachedUrl}
                                  fetchDownloadUrl={fetchDownloadUrl}
                                  className="h-9 w-9"
                                />
                                <div className="flex flex-col">
                                  <span className="text-sm font-semibold text-foreground">{file.name}</span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                              {getKindLabel(file.name)}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">{formatSize(file.size)}</TableCell>
                            <TableCell>{formatRelative(file.updatedAt)}</TableCell>
                          </TableRow>
                        );
                      })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {viewMode === "grid" && tableItems.length > 0 && (
                  <div className="mt-3 grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-1 overflow-y-auto rounded-lg border border-border bg-card p-3 sm:grid-cols-4 md:grid-cols-6">
                    {tableItems.map((item) => {
                      if (item.kind === "folder") {
                        const active = currentFolder === item.path;
                        return (
                          <div
                            key={item.id}
                            onClick={() => handleRefresh(item.path, false)}
                            className={cn(
                              "group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-md p-2 text-center hover:bg-accent",
                              active && "bg-accent",
                            )}
                          >
                            {!item.isParent && (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-background group-hover:opacity-100"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <MoreHorizontalIcon className="size-3.5" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleDeleteFolder(item.path);
                                    }}
                                  >
                                    <Trash2Icon className="mr-2 size-4" /> 삭제
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                            <FolderIcon className="size-12 text-muted-foreground" />
                            <span className="line-clamp-2 text-xs font-medium text-foreground">{item.name}</span>
                          </div>
                        );
                      }
                      const file = item.file;
                      const selected = selectedFileIds.has(file.id);
                      return (
                        <div
                          key={file.id}
                          onClick={() => setPreviewFile(file)}
                          className={cn(
                            "group relative flex cursor-pointer flex-col items-center gap-1.5 rounded-md p-2 text-center hover:bg-accent",
                            selected && "bg-accent",
                          )}
                        >
                          <input
                            type="checkbox"
                            aria-label={`${file.name} 선택`}
                            checked={selected}
                            onChange={() => toggleFileSelection(file.id)}
                            onClick={(event) => event.stopPropagation()}
                            className={cn(
                              "absolute left-1 top-1 size-4 accent-foreground opacity-0 transition group-hover:opacity-100",
                              selected && "opacity-100",
                            )}
                          />
                          <FileThumbnail
                            file={file}
                            getCachedUrl={getCachedUrl}
                            fetchDownloadUrl={fetchDownloadUrl}
                            className="h-16 w-16"
                          />
                          <span className="line-clamp-2 text-xs font-medium text-foreground">{file.name}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {showEmptyState && (
                  <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-5 py-10 text-center">
                    <FolderIcon className="size-8 text-muted-foreground" />
                    <p className="font-medium">비어 있어요. 파일을 업로드해 보세요.</p>
                    <p className="text-sm text-muted-foreground">새 폴더를 만들고 파일을 추가해 보세요.</p>
                  </div>
                )}
            </>
          )}

          {isSearchMode && (
            <div className="flex min-h-0 flex-1 rounded-lg border border-border bg-card">
              <div className="max-h-[60vh] flex-1 overflow-y-auto">
                {isSearching && searchResults.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center text-sm text-muted-foreground">
                    검색하는 중...
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
                    <SearchIcon className="size-8 text-muted-foreground" />
                    <p className="font-medium">검색 결과가 없어요.</p>
                    <p className="text-sm text-muted-foreground">다른 이름으로 검색해 보세요.</p>
                  </div>
                ) : (
                  <Table className="[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-card">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky top-0 z-10 bg-card">파일명</TableHead>
                        <TableHead className="sticky top-0 z-10 bg-card">위치</TableHead>
                        <TableHead className="sticky top-0 z-10 hidden bg-card sm:table-cell">크기</TableHead>
                        <TableHead className="sticky top-0 z-10 bg-card">업데이트</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {searchResults.map((result) => (
                        <TableRow
                          key={result.id}
                          className="cursor-pointer"
                          onClick={() => handleSearchResultClick(result)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <FileThumbnail file={result} getCachedUrl={getCachedUrl} fetchDownloadUrl={fetchDownloadUrl} />
                              <span className="text-sm font-semibold text-foreground">{result.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{result.folder || "루트"}</TableCell>
                          <TableCell className="hidden sm:table-cell">{formatSize(result.size)}</TableCell>
                          <TableCell>{formatRelative(result.updatedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelectionChange} />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        webkitdirectory="true"
        directory="true"
        className="hidden"
        onChange={handleFolderSelectionChange}
      />

      <div className="fixed bottom-6 right-6 z-20">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
            disabled={isUploading}
            aria-label="업로드"
          >
            {isUploading ? (
              <span className="text-xs font-semibold">{progress}%</span>
            ) : (
              <PlusIcon className="size-5" />
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            <DropdownMenuItem onClick={() => handleQuickPick("file")}>
              <FileUpIcon className="mr-2 size-4" /> 파일 업로드
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleQuickPick("folder")}>
              <FolderPlusIcon className="mr-2 size-4" /> 폴더 업로드
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CommandDialog open={isCommandOpen} onOpenChange={setIsCommandOpen}>
        <CommandInput autoFocus placeholder="파일 이름을 검색하세요." />
        <CommandList>
          <CommandEmpty>검색 결과가 없어요.</CommandEmpty>
          <CommandGroup heading="현재 위치">
            <CommandItem value="current" disabled>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background">
                  <FolderIcon className="size-4 text-muted-foreground" />
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-sm font-semibold text-foreground">{currentLabel}</span>
                  <span className="text-xs text-muted-foreground">{files.length}개의 파일</span>
                </div>
              </div>
            </CommandItem>
          </CommandGroup>
          {!isRoot && (
            <CommandGroup heading="탐색">
              <CommandItem
                value="parent-folder"
                onSelect={() => {
                  setIsCommandOpen(false);
                  handleRefresh(parentPath, false);
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-accent text-sm font-semibold text-foreground">
                    ..
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-foreground">상위 폴더</span>
                    <span className="text-xs text-muted-foreground">{parentPath || "루트"}</span>
                  </div>
                </div>
                <CommandShortcut>⌘F</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          )}
          {visibleFolders.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="폴더">
                {visibleFolders.map((folder) => {
                  const folderPath = composePath(folder);
                  return (
                    <CommandItem
                      key={`cmd-folder-${folder}`}
                      value={`folder-${folder}`}
                      onSelect={() => {
                        setIsCommandOpen(false);
                        handleRefresh(folderPath, false);
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background">
                          <FolderIcon className="size-4 text-muted-foreground" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-foreground">{folder}</span>
                          <span className="text-xs text-muted-foreground">현재 폴더</span>
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          )}
          {files.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="파일">
                {files.map((file) => (
                  <CommandItem
                    key={`cmd-file-${file.id}`}
                    value={`${file.name} ${file.path}`}
                    onSelect={() => {
                      setPreviewFile(file);
                      setIsCommandOpen(false);
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background">
                        <FileIcon
                          extension={getExtension(file.name)}
                          {...(defaultStyles[getExtension(file.name)] || defaultStyles.default)}
                        />
                      </div>
                      <div className="flex flex-col text-left">
                        <span className="text-sm font-semibold text-foreground">{file.name}</span>
                        <span className="text-xs text-muted-foreground">{file.path || "루트"}</span>
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>

      <Dialog open={isUploading && uploadItems.length > 0}>
        <DialogContent className="max-w-sm space-y-4" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>업로드 중...</DialogTitle>
            <DialogDescription>{uploadItems.length}개의 파일을 처리하고 있습니다.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {[...uploadItems]
              .sort((a, b) => {
                const order: Record<UploadStatus, number> = { uploading: 0, pending: 1, error: 2, success: 3 };
                return order[a.status] - order[b.status];
              })
              .map((item) => (
                <div key={item.id} className="rounded-md border border-border bg-card px-3 py-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{item.name}</span>
                    <span>
                      {item.progress}% · {item.status === "success" ? "완료" : item.status === "error" ? "실패" : "진행 중"}
                    </span>
                  </div>
                  <Progress value={item.progress} className="mt-2 h-2" />
                </div>
              ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isMoveDialogOpen}
        onOpenChange={(open) => {
          setIsMoveDialogOpen(open);
          if (!open) {
            setMoveTarget(null);
          }
        }}
      >
        <DialogContent className="max-w-lg space-y-4">
          <DialogHeader>
            <DialogTitle>파일 이동</DialogTitle>
            <DialogDescription>선택한 파일을 다른 폴더로 이동합니다.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleMoveSubmit}>
            {isFoldersLoading ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                폴더 목록을 불러오는 중...
              </div>
            ) : (
              <Command className="rounded-lg border border-border bg-popover">
                <CommandInput placeholder="폴더 검색" />
                <CommandList>
                  <CommandEmpty>폴더가 없습니다.</CommandEmpty>
                  <CommandGroup heading="대상 위치">
                    <CommandItem
                      value="__root"
                      onSelect={() => setMoveTarget("")}
                      className="justify-between"
                    >
                      <div className="flex flex-col text-left">
                        <span className="text-sm font-semibold text-foreground">루트</span>
                        <span className="text-xs text-muted-foreground">최상위 경로</span>
                      </div>
                      {moveTarget === "" && <CheckIcon className="size-4 text-foreground" />}
                    </CommandItem>
                    {availableFolders.map((folder) => (
                      <CommandItem
                        key={`move-folder-${folder}`}
                        value={folder}
                        onSelect={() => setMoveTarget(folder)}
                        className="justify-between"
                      >
                        <div className="flex flex-col text-left">
                          <span className="text-sm font-semibold text-foreground">{folder}</span>
                          <span className="text-xs text-muted-foreground">폴더</span>
                        </div>
                        {moveTarget === folder && <CheckIcon className="size-4 text-foreground" />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            )}
            <div className="text-xs text-muted-foreground">
              현재 위치: {currentLabel} · 이동 대상: {moveTarget === "" ? "루트" : moveTarget || "(선택 필요)"}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setIsMoveDialogOpen(false)}>
                취소
              </Button>
              <Button
                type="submit"
                disabled={
                  isMutating ||
                  selectedCount === 0 ||
                  moveTarget === null ||
                  moveTarget === (currentFolder || "")
                }
              >
                이동
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isFolderDialogOpen}
        onOpenChange={(open) => {
          setIsFolderDialogOpen(open);
          if (!open) {
            setNewFolder("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>새 폴더 만들기</DialogTitle>
            <DialogDescription>현재 위치({currentLabel || "루트"})에 폴더를 추가합니다.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreateFolder}>
            <div className="space-y-2">
              <Label htmlFor="folder-name" className="text-xs text-muted-foreground">
                폴더 이름
              </Label>
              <Input
                id="folder-name"
                value={newFolder}
                onChange={(event) => setNewFolder(event.target.value)}
                placeholder="예: photos"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setIsFolderDialogOpen(false)}>
                취소
              </Button>
              <Button type="submit" disabled={!newFolder.trim() || isMutating}>
                만들기
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(previewFile)} onOpenChange={(open) => (!open ? setPreviewFile(null) : null)}>
        <DialogContent className="max-w-md space-y-4 sm:max-w-lg" showCloseButton>
          <DialogHeader className="space-y-1 pr-6">
            <DialogTitle>{previewFile?.name}</DialogTitle>
            <DialogDescription>
              {previewFile ? `${formatSize(previewFile.size)} · ${previewFile.contentType ?? "파일"}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-dashed border-border bg-background p-3">
            {previewFile ? (
              previewKind === "image" ? (
                previewLink ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewLink}
                    alt={previewFile.name}
                    className="mx-auto max-h-[360px] w-full object-contain"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    이미지 링크를 불러오는 중...
                  </div>
                )
              ) : previewKind === "video" ? (
                previewLink ? (
                  <video
                    src={previewLink}
                    controls
                    className="mx-auto max-h-[360px] w-full object-contain"
                    playsInline
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    영상 링크를 불러오는 중...
                  </div>
                )
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                  <div className="h-12 w-12">
                    <FileIcon
                      extension={getExtension(previewFile.name)}
                      {...(defaultStyles[getExtension(previewFile.name)] || defaultStyles.default)}
                    />
                  </div>
                  <p>이 파일은 미리보기를 지원하지 않아요.</p>
                </div>
              )
            ) : null}
          </div>
          {previewFile && (
            <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                <Button size="sm" variant="secondary" onClick={() => handleGenerateLink(previewFile, false, true)}>
                  다운로드
                </Button>
              <Button size="sm" variant="ghost" onClick={() => handleGenerateLink(previewFile, true)}>
                링크 복사
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRenameTarget(previewFile);
                  setRenameValue(previewFile.name);
                }}
              >
                이름 변경
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameValue("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이름 변경</DialogTitle>
            <DialogDescription>파일 이름을 수정하고 저장하세요.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleRenameSubmit}>
            <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setRenameTarget(null)}>
                취소
              </Button>
              <Button type="submit" disabled={!renameValue.trim()}>
                저장
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getExtension(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "txt";
}

const KIND_LABELS: Record<string, string> = {
  jpg: "JPEG 이미지",
  jpeg: "JPEG 이미지",
  png: "PNG 이미지",
  gif: "GIF 이미지",
  webp: "WebP 이미지",
  heic: "HEIC 이미지",
  svg: "SVG 이미지",
  mp4: "MP4 동영상",
  mov: "MOV 동영상",
  m4v: "동영상",
  webm: "동영상",
  pdf: "PDF 문서",
  doc: "Word 문서",
  docx: "Word 문서",
  xls: "Excel 문서",
  xlsx: "Excel 문서",
  ppt: "PowerPoint 문서",
  pptx: "PowerPoint 문서",
  zip: "압축 파일",
  txt: "텍스트 문서",
};

function getKindLabel(name: string) {
  const extension = getExtension(name);
  return KIND_LABELS[extension] ?? `${extension.toUpperCase()} 파일`;
}

function deriveRelativeFolder(root: string, relativePath?: string) {
  if (!relativePath) return root || undefined;
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return root || undefined;
  }
  segments.pop();
  const relative = segments.join("/");
  return root ? `${root}/${relative}` : relative;
}

type PreviewKind = "image" | "video";

const IMAGE_PREVIEW_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "heic",
  "heif",
  "tif",
  "tiff",
];
const VIDEO_PREVIEW_EXTENSIONS = ["mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv", "3gp"];

function getPreviewType(file: StorageFile): PreviewKind | null {
  if (file.contentType?.startsWith("image/")) return "image";
  if (file.contentType?.startsWith("video/")) return "video";
  const extension = getExtension(file.name);
  if (IMAGE_PREVIEW_EXTENSIONS.includes(extension)) return "image";
  if (VIDEO_PREVIEW_EXTENSIONS.includes(extension)) return "video";
  return null;
}

function FileThumbnail({
  file,
  getCachedUrl,
  fetchDownloadUrl,
  className,
}: {
  file: StorageFile;
  getCachedUrl: (file: StorageFile) => string | null;
  fetchDownloadUrl: (file: StorageFile) => Promise<string | null>;
  className?: string;
}) {
  const previewType = getPreviewType(file);
  const cachedUrl = previewType ? getCachedUrl(file) : null;
  const nodeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!previewType || cachedUrl) return;
    const node = nodeRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        fetchDownloadUrl(file);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [file, previewType, cachedUrl, fetchDownloadUrl]);

  return (
    <div ref={nodeRef} className={cn("h-12 w-12 overflow-hidden rounded-md border border-border bg-background", className)}>
      {previewType === "image" && cachedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cachedUrl} alt={file.name} loading="lazy" className="h-full w-full object-cover" />
      ) : previewType === "video" && cachedUrl ? (
        <video src={cachedUrl} className="h-full w-full object-cover" muted playsInline loop preload="metadata" />
      ) : previewType ? (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
          로딩 중...
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <FileIcon
            extension={getExtension(file.name)}
            {...(defaultStyles[getExtension(file.name)] || defaultStyles.default)}
          />
        </div>
      )}
    </div>
  );
}
