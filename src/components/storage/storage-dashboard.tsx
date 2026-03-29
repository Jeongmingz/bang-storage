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
import {
  FolderIcon,
  FolderPlusIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  RefreshCcwIcon,
  Trash2Icon,
  UploadCloudIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  createFolderAction,
  createUploadUrl,
  deleteFilesAction,
  deleteFolderAction,
  generateDownloadLink,
  logout,
  refreshFiles,
  renameFileAction,
} from "@/app/actions";
import type { StorageFile, StorageSnapshot } from "@/lib/storage";
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

export function StorageDashboard({ initialSnapshot, bucketName }: Props) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [bucket, setBucket] = useState(bucketName);
  const [currentFolder, setCurrentFolder] = useState(initialSnapshot.path ?? DEFAULT_FOLDER);
  const [isUploading, setIsUploading] = useState(false);
  const [isMutating, startMutate] = useTransition();
  const [isRefreshing, startRefreshing] = useTransition();
  const [progress, setProgress] = useState(0);
  const [fileSelection, setFileSelection] = useState<string[]>([]);
  const [folderSelection, setFolderSelection] = useState<string[]>([]);
  const [newFolder, setNewFolder] = useState("");
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<StorageFile | null>(null);
  const [renameTarget, setRenameTarget] = useState<StorageFile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [fileDropActive, setFileDropActive] = useState(false);
  const [folderDropActive, setFolderDropActive] = useState(false);
  const [quickUploadMode, setQuickUploadMode] = useState<"file" | "folder" | null>(null);
  const [fileUrls, setFileUrls] = useState<Record<string, { url: string; expiresAt: number }>>({});
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const files = snapshot.files;
  const folders = snapshot.folders;
  const visibleFolders = folders.filter((folder) => !folder.startsWith(".keep"));


  const handleUnauthorized = useCallback(
    (message: string) => {
      if (message.includes("세션")) {
        router.refresh();
      }
    },
    [router],
  );

  const handleSnapshotUpdate = (next: StorageSnapshot, nextBucket?: string) => {
    setSnapshot(next);
    setCurrentFolder(next.path ?? DEFAULT_FOLDER);
    if (nextBucket) {
      setBucket(nextBucket);
    }
  };

  const handleFileSelectionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = Array.from(event.target.files ?? []);
    setFileSelection(rawFiles.map((file) => `${file.name} · ${formatSize(file.size)}`));

    if (quickUploadMode === "file") {
      const files = rawFiles.filter((file) => file.size > 0);
      if (files.length > 0) {
        uploadFilesWithMode(files, false).finally(() => {
          setQuickUploadMode(null);
          setFileSelection([]);
          if (fileInputRef.current) fileInputRef.current.value = "";
        });
      } else {
        setQuickUploadMode(null);
      }
    }
  };

  const handleFolderSelectionChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = Array.from(event.target.files ?? []);
    setFolderSelection(
      rawFiles.map((file) => {
        const relativeFolder = deriveRelativeFolder(currentFolder ?? "", file.webkitRelativePath);
        const label = relativeFolder ? `${relativeFolder}/${file.name}` : file.name;
        return `${label} · ${formatSize(file.size)}`;
      }),
    );

    if (quickUploadMode === "folder") {
      const files = rawFiles.filter((file) => file.size > 0);
      if (files.length > 0) {
        uploadFilesWithMode(files, true).finally(() => {
          setQuickUploadMode(null);
          setFolderSelection([]);
          if (folderInputRef.current) folderInputRef.current.value = "";
        });
      } else {
        setQuickUploadMode(null);
      }
    }
  };

  const uploadFilesWithMode = async (files: File[], useRelativePaths: boolean) => {
    if (files.length === 0) {
      toast.error("업로드할 파일을 선택하세요.");
      return;
    }

    setIsUploading(true);
    setProgress(0);

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index] as RelativeFile;
        const payload = new FormData();
        payload.set("fileName", file.name);
        const relativeFolder = useRelativePaths
          ? deriveRelativeFolder(currentFolder ?? "", file.webkitRelativePath)
          : currentFolder || undefined;
        if (relativeFolder) payload.set("folder", relativeFolder);
        if (file.type) payload.set("contentType", file.type);

        const uploadTarget = await createUploadUrl(payload);
        if (!uploadTarget.success || !uploadTarget.uploadUrl) {
          toast.error(uploadTarget.message ?? "업로드 URL을 만들지 못했습니다.");
          return;
        }

        const response = await fetch(uploadTarget.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        });

        if (!response.ok) {
          toast.error("업로드 중 오류가 발생했습니다.");
          return;
        }

        setProgress(Math.round(((index + 1) / files.length) * 100));
      }

      const refreshed = await refreshFiles(currentFolder);
      if (refreshed.success && refreshed.snapshot) {
        handleSnapshotUpdate(refreshed.snapshot, refreshed.bucket);
        toast.success(`${files.length}개의 파일을 업로드했습니다.`);
      } else if (!refreshed.success) {
        toast.error(refreshed.message);
        handleUnauthorized(refreshed.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "업로드 중 오류가 발생했습니다.");
    } finally {
      setIsUploading(false);
      setProgress(0);
    }
  };

  const handleFileUploadSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const files = Array.from(fileInputRef.current?.files ?? []).filter((file) => file.size > 0);
    uploadFilesWithMode(files, false).then(() => {
      setFileSelection([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  };

  const handleFolderUploadSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const files = Array.from(folderInputRef.current?.files ?? []).filter((file) => file.size > 0);
    uploadFilesWithMode(files, true).then(() => {
      setFolderSelection([]);
      if (folderInputRef.current) folderInputRef.current.value = "";
    });
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>, mode: "file" | "folder") => {
    event.preventDefault();
    if (mode === "file") {
      setFileDropActive(false);
    } else {
      setFolderDropActive(false);
    }

    const files = Array.from(event.dataTransfer.files ?? []).filter((file) => file.size > 0);
    if (files.length === 0) return;

    if (mode === "file") {
      setFileSelection(files.map((file) => `${file.name} · ${formatSize(file.size)}`));
    } else {
      setFolderSelection(
        files.map((file) => {
          const relativeFolder = deriveRelativeFolder(currentFolder ?? "", (file as RelativeFile).webkitRelativePath);
          const label = relativeFolder ? `${relativeFolder}/${file.name}` : file.name;
          return `${label} · ${formatSize(file.size)}`;
        }),
      );
    }

    uploadFilesWithMode(files, mode === "folder").catch(() => {
      /* errors handled in helper */
    });
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>, mode: "file" | "folder") => {
    event.preventDefault();
    if (mode === "file") {
      setFileDropActive(true);
    } else {
      setFolderDropActive(true);
    }
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>, mode: "file" | "folder") => {
    event.preventDefault();
    if (mode === "file") {
      setFileDropActive(false);
    } else {
      setFolderDropActive(false);
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

  const handleGenerateLink = (file: StorageFile, copyToClipboard = false) => {
    startMutate(() => {
      fetchDownloadUrl(file).then(async (url) => {
        if (!url) return;
        if (copyToClipboard) {
          await navigator.clipboard.writeText(url);
          toast.success("링크를 복사했습니다.");
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

  useEffect(() => {
    const missing = files.filter((file) => getPreviewType(file) && !getCachedUrl(file));
    if (missing.length === 0) return;
    missing.forEach((file) => {
      fetchDownloadUrl(file);
    });
  }, [files, getCachedUrl, fetchDownloadUrl]);

  const getPreviewUrl = (file: StorageFile) => {
    if (!getPreviewType(file)) return null;
    return getCachedUrl(file);
  };

  const selectedFiles = useMemo(() => files.filter((file) => selectedFileIds.has(file.id)), [files, selectedFileIds]);
  const selectedCount = selectedFiles.length;
  const allSelected = files.length > 0 && selectedCount === files.length;
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
      if (files.every((file) => prev.has(file.id))) {
        return new Set();
      }
      return new Set(files.map((file) => file.id));
    });
  };

  const clearSelection = () => setSelectedFileIds(new Set());

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
  const composePath = (folderName: string) =>
    (currentFolder ? `${currentFolder}/${folderName}` : folderName).replace(/\/+/, "/");
  const parentPath = useMemo(() => {
    if (!currentFolder) return "";
    const segments = currentFolder.split("/").filter(Boolean);
    segments.pop();
    return segments.join("/");
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
    const fileItems = files.map((file) => ({
      kind: "file" as const,
      id: file.id,
      file,
    }));
    return [...parentItem, ...folderItems, ...fileItems];
  }, [visibleFolders, files, currentFolder, isRoot, parentPath]);

  const breadcrumbItems = useMemo(() => {
    const segments = currentFolder ? currentFolder.split("/").filter(Boolean) : [];
    const items = [{ label: "전체", path: "" }];
    let path = "";
    segments.forEach((segment) => {
      path = path ? `${path}/${segment}` : segment;
      items.push({ label: segment, path });
    });
    return items;
  }, [currentFolder]);

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-gradient-to-br from-pink-50 via-rose-50 to-white px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-4">
        <section className="border border-pink-200/80 bg-white/95 p-4 shadow-md">
          <div className="flex flex-row gap-3 items-center justify-between">
            <p className="text-xs uppercase tracking-[0.3em] text-rose-400">지현&정민 저장소</p>
            <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="로그아웃">
              <LogOutIcon className="size-4" />
            </Button>
          </div>        </section>

        <section className="border border-pink-200/80 bg-white/95 p-4 shadow-md">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground sm:text-base">폴더 탐색</h2>
                <p className="text-xs text-muted-foreground">{currentLabel || "루트"} 기준으로 이동해요.</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={isRoot ? "default" : "ghost"}
                  size="sm"
                  className="gap-2"
                  onClick={() => handleRefresh("", false)}
                >
                  <FolderIcon className="size-4" /> 루트
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="gap-2"
                  onClick={() => setIsFolderDialogOpen(true)}
                >
                  <FolderPlusIcon className="size-4" /> 새 폴더
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-pink-200/80 p-3">
              {tableItems.length === 0 ? (
                <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-3 border border-dashed border-pink-200 px-5 py-10 text-center sm:min-h-[300px]">
                  <FolderIcon className="size-8 text-rose-300" />
                  <p className="font-medium">비어 있어요. 파일을 업로드해 보세요.</p>
                  <p className="text-sm text-muted-foreground">새 폴더를 만들고 소중한 순간을 채워보세요.</p>
                </div>
              ) : (
                <div className="overflow-hidden">
                  {selectedCount > 0 && (
                    <div className="mt-4 flex flex-wrap items-center justify-between px-2.5 text-xs text-muted-foreground sm:text-sm">
                      <span>{selectedCount}개의 파일이 선택되었습니다.</span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={handleBulkDownload}>
                          다운로드
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
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8">
                          <input
                            type="checkbox"
                            aria-label="모두 선택"
                            checked={allSelected}
                            onChange={handleSelectAll}
                            className="size-4 accent-rose-500"
                          />
                        </TableHead>
                        <TableHead>파일명</TableHead>
                        <TableHead className="hidden sm:table-cell">크기</TableHead>
                        <TableHead>업데이트</TableHead>
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
                                    <div className={`flex h-12 w-12 items-center justify-center border ${active ? "border-rose-300 bg-rose-50" : "border-pink-100 bg-white"
                                      }`}>
                                      <FolderIcon className="size-5 text-rose-400" />
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
                                        className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-rose-100"
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
                              <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">폴더</TableCell>
                              <TableCell className="text-xs text-muted-foreground">—</TableCell>
                            </TableRow>
                          );
                        }
                        const file = item.file;
                        const previewType = getPreviewType(file);
                        const previewUrl = previewType ? getPreviewUrl(file) : null;
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
                                className="size-4 accent-rose-500"
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <div className="h-12 w-12 overflow-hidden border border-pink-100 bg-white">
                                  {previewType === "image" && previewUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={previewUrl ?? undefined}
                                      alt={file.name}
                                      loading="lazy"
                                      className="h-full w-full object-cover"
                                    />
                                  ) : previewType === "video" && previewUrl ? (
                                    <video
                                      src={previewUrl}
                                      className="h-full w-full object-cover"
                                      muted
                                      playsInline
                                      loop
                                      preload="metadata"
                                    />
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
                                <div className="flex flex-col">
                                  <span className="text-sm font-semibold text-foreground">{file.name}</span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">{formatSize(file.size)}</TableCell>
                            <TableCell>{formatRelative(file.updatedAt)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                {breadcrumbItems.map((item, index) => {
                  const isLast = index === breadcrumbItems.length - 1;
                  return (
                    <div key={`${item.path || "root"}-${index}`} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleRefresh(item.path, false)}
                        className={`rounded-full px-3 py-1 font-medium transition ${isLast ? "bg-rose-100 text-rose-500" : "text-muted-foreground hover:bg-rose-50 hover:text-rose-500"
                          }`}
                      >
                        {item.label}
                      </button>
                      {index < breadcrumbItems.length - 1 && <span className="text-rose-200">/</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="hidden border border-pink-200/80 bg-white/95 p-2.5 shadow-md sm:block">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">파일 · 폴더 업로드</h2>
              <p className="text-sm text-muted-foreground">드래그하거나 선택해서 {currentLabel || "루트"}로 저장하세요.</p>
            </div>
            <UploadCloudIcon className="size-5 text-rose-400" />
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <form className="space-y-3 border border-pink-100 p-3" onSubmit={handleFileUploadSubmit}>
              <input type="hidden" name="folder" value={currentFolder} />
              <div
                className={`border-2 border-dashed p-5 text-center transition ${fileDropActive ? "border-rose-400 bg-rose-50" : "border-pink-200"}`}
                onDragOver={(event) => handleDragOver(event, "file")}
                onDragLeave={(event) => handleDragLeave(event, "file")}
                onDrop={(event) => handleDrop(event, "file")}
              >
                <p className="text-sm text-muted-foreground">파일을 드래그하거나 버튼으로 선택하세요.</p>
                <div className="mt-4 flex flex-col items-center gap-2">
                  <Button type="button" size="sm" onClick={() => fileInputRef.current?.click()}>
                    파일 선택
                  </Button>
                  <p className="text-xs text-muted-foreground">현재 폴더: {currentLabel}</p>
                </div>
                <Input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelectionChange} />
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {fileSelection.length === 0 ? (
                  <li>선택된 파일이 없습니다.</li>
                ) : (
                  fileSelection.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)
                )}
              </ul>
              <Button type="submit" className="w-full" disabled={isUploading}>
                파일 업로드
              </Button>
            </form>

            <form className="space-y-3 border border-pink-100 p-3" onSubmit={handleFolderUploadSubmit}>
              <input type="hidden" name="folder" value={currentFolder} />
              <div
                className={`border-2 border-dashed p-5 text-center transition ${folderDropActive ? "border-rose-400 bg-rose-50" : "border-pink-200"}`}
                onDragOver={(event) => handleDragOver(event, "folder")}
                onDragLeave={(event) => handleDragLeave(event, "folder")}
                onDrop={(event) => handleDrop(event, "folder")}
              >
                <p className="text-sm text-muted-foreground">폴더를 드래그하거나 버튼으로 선택하세요.</p>
                <div className="mt-4 flex flex-col items-center gap-2">
                  <Button type="button" size="sm" onClick={() => folderInputRef.current?.click()}>
                    폴더 선택
                  </Button>
                  <p className="text-xs text-muted-foreground">현재 폴더: {currentLabel}</p>
                </div>
                <Input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  webkitdirectory="true"
                  directory="true"
                  className="hidden"
                  onChange={handleFolderSelectionChange}
                />
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {folderSelection.length === 0 ? (
                  <li>선택된 폴더가 없습니다.</li>
                ) : (
                  folderSelection.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)
                )}
              </ul>
              <Button type="submit" className="w-full" disabled={isUploading}>
                폴더 업로드
              </Button>
            </form>
          </div>
          {isUploading && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>업로드 중...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}
        </section>
      </div>

      <div className="fixed bottom-3 left-1/2 z-20 w-full max-w-md -translate-x-1/2 px-3 sm:hidden">
        <div className="border border-pink-200/70 bg-white/95 px-3 py-2.5 shadow-md">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>빠른 업로드</span>
            <span>{currentLabel || "루트"}</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">선택 즉시 업로드돼요.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              size="sm"
              className="rounded-2xl"
              disabled={isUploading}
              onClick={() => handleQuickPick("file")}
            >
              {isUploading && quickUploadMode === "file" ? "업로드 중" : "파일 선택"}
            </Button>
            <Button
              size="sm"
              className="rounded-2xl"
              disabled={isUploading}
              onClick={() => handleQuickPick("folder")}
            >
              {isUploading && quickUploadMode === "folder" ? "업로드 중" : "폴더 선택"}
            </Button>
          </div>
        </div>
      </div>

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
        <DialogContent className="max-w-md sm:max-w-lg">
          <div className="flex items-start justify-between gap-3">
            <div>
              <DialogTitle>{previewFile?.name}</DialogTitle>
              <DialogDescription>
                {previewFile ? `${formatSize(previewFile.size)} · ${previewFile.contentType ?? "파일"}` : ""}
              </DialogDescription>
            </div>
            {previewFile && (
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => handleGenerateLink(previewFile)}>
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
          </div>
          <div className="mt-4 min-h-[240px] border border-dashed border-pink-200 bg-white p-3">
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
