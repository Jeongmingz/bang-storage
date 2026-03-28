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
  ArrowLeftIcon,
  CopyIcon,
  FolderIcon,
  FolderPlusIcon,
  LinkIcon,
  LogOutIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCcwIcon,
  Trash2Icon,
  UploadCloudIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  createFolderAction,
  createUploadUrl,
  deleteFileAction,
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
  const [previewFile, setPreviewFile] = useState<StorageFile | null>(null);
  const [renameTarget, setRenameTarget] = useState<StorageFile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [fileDropActive, setFileDropActive] = useState(false);
  const [folderDropActive, setFolderDropActive] = useState(false);
  const [quickUploadMode, setQuickUploadMode] = useState<"file" | "folder" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const files = snapshot.files;
  const folders = snapshot.folders;


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

  const handleDelete = (path: string) => {
    startMutate(() => {
      deleteFileAction(path, currentFolder).then((result) => {
        if (result.success && result.snapshot) {
          handleSnapshotUpdate(result.snapshot);
          toast.success("파일을 삭제했습니다.");
        } else if (!result.success) {
          toast.error(result.message);
          handleUnauthorized(result.message);
        }
      });
    });
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

  const handleGenerateLink = (path: string, copyToClipboard = false) => {
    startMutate(() => {
      generateDownloadLink(path).then(async (result) => {
        if (result.success && result.url) {
          if (copyToClipboard) {
            await navigator.clipboard.writeText(result.url);
            toast.success("다운로드 링크를 복사했습니다.");
          } else {
            window.open(result.url, "_blank");
          }
        } else if (!result.success) {
          toast.error(result.message);
          handleUnauthorized(result.message);
        }
      });
    });
  };

  const handleRefresh = (folder?: string) => {
    startRefreshing(() => {
      refreshFiles(folder).then((result) => {
        if (result.success && result.snapshot) {
          handleSnapshotUpdate(result.snapshot, result.bucket);
          toast.success("새로고침 완료");
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

  const totalFolders = folders.length;
  const isRoot = !currentFolder;
  const currentLabel = currentFolder || "루트";
  const composePath = (folderName: string) =>
    (currentFolder ? `${currentFolder}/${folderName}` : folderName).replace(/\/+/, "/");

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const updateMatches = () => setIsMobile(mediaQuery.matches);
    updateMatches();
    mediaQuery.addEventListener("change", updateMatches);
    return () => mediaQuery.removeEventListener("change", updateMatches);
  }, []);

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
      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="flex w-full flex-col gap-4 rounded-3xl border border-pink-200/80 bg-white/90 p-4 shadow-lg lg:w-72">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-rose-400">지현&정민 저장소</p>
              <p className="text-base font-semibold text-foreground">{bucket}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOutIcon className="size-4" />
            </Button>
          </div>
          <div className="space-y-1">
            <Button
              variant={isRoot ? "default" : "ghost"}
              size="sm"
              className="w-full justify-start gap-2"
              onClick={() => handleRefresh("")}
            >
              <FolderIcon className="size-4" /> 루트
            </Button>
            <div className="space-y-1">
              {totalFolders === 0 && <p className="text-xs text-muted-foreground">폴더를 만들어보세요.</p>}
              {folders.map((folder) => {
                const folderPath = composePath(folder);
                const active = currentFolder === folderPath;
                return (
                  <div
                    key={folderPath}
                    className={`group flex items-center justify-between rounded-2xl px-2 py-1.5 ${active ? "bg-pink-100" : "bg-transparent"}`}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 justify-start gap-2"
                      onClick={() => handleRefresh(folderPath)}
                    >
                      <FolderIcon className="size-4" />
                      {folder}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-rose-100">
                        <MoreHorizontalIcon className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteFolder(folderPath)}>
                          <Trash2Icon className="mr-2 size-4" /> 삭제
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          </div>
          <form onSubmit={handleCreateFolder} className="mt-auto space-y-2">
            <Label className="text-xs text-muted-foreground">새 폴더</Label>
            <div className="flex items-center gap-2 rounded-2xl border border-dashed border-pink-200 px-3 py-2">
              <FolderPlusIcon className="size-4 text-rose-400" />
              <Input
                value={newFolder}
                onChange={(event) => setNewFolder(event.target.value)}
                placeholder="예: photos"
                className="border-none px-0 text-sm focus-visible:ring-0"
              />
              <Button type="submit" size="sm" disabled={isMutating}>
                만들기
              </Button>
            </div>
          </form>
        </aside>

        <main className="flex flex-1 flex-col gap-3">
          <div className="rounded-2xl border border-pink-200/80 bg-white/95 p-3 shadow-md">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {breadcrumbItems.map((item, index) => {
                  const isLast = index === breadcrumbItems.length - 1;
                  return (
                    <div key={`${item.path || "root"}-${index}`} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleRefresh(item.path)}
                        className={`rounded-full px-3 py-1 font-medium transition ${isLast
                            ? "bg-rose-100 text-rose-500"
                            : "text-muted-foreground hover:bg-rose-50 hover:text-rose-500"
                          }`}
                      >
                        {item.label}
                      </button>
                      {index < breadcrumbItems.length - 1 && <span className="text-rose-200">/</span>}
                    </div>
                  );
                })}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto"
                onClick={() => handleRefresh(currentFolder)}
                disabled={isRefreshing}
              >
                <RefreshCcwIcon className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 rounded-2xl border border-pink-200/80 bg-white/95 p-3 shadow-md">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{currentLabel}</h2>
                <p className="text-sm text-muted-foreground">파일 {files.length}개</p>
              </div>
              {!isRoot && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRefresh(currentFolder.split("/").slice(0, -1).join("/"))}
                  className="gap-1"
                >
                  <ArrowLeftIcon className="size-4" />
                  위로 가기
                </Button>
              )}
            </div>

            {files.length === 0 ? (
              <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-pink-200 px-5 py-10 text-center sm:min-h-[300px]">
                <FolderIcon className="size-8 text-rose-300" />
                <p className="font-medium">비어 있어요. 파일을 업로드해 보세요.</p>
                <p className="text-sm text-muted-foreground">새 폴더를 만들고 소중한 순간을 채워보세요.</p>
              </div>
            ) : (
              <div className="mt-3 overflow-hidden rounded-2xl border border-pink-100">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>파일명</TableHead>
                      <TableHead>크기</TableHead>
                      <TableHead>업데이트</TableHead>
                      <TableHead className="text-right">작업</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((file) => (
                      <TableRow
                        key={file.id}
                        className="cursor-pointer"
                        onDoubleClick={() => {
                          if (!isMobile) setPreviewFile(file);
                        }}
                        onClick={() => {
                          if (isMobile) setPreviewFile(file);
                        }}
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-6">
                              <FileIcon
                                extension={getExtension(file.name)}
                                {...(defaultStyles[getExtension(file.name)] || defaultStyles.default)}
                              />
                            </div>
                            <div className="flex flex-col">
                              <span className="text-sm font-semibold text-foreground">{file.name}</span>
                              <span className="text-xs text-muted-foreground">{file.contentType ?? "파일"}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{formatSize(file.size)}</TableCell>
                        <TableCell>{formatRelative(file.updatedAt)}</TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-rose-100">
                              <PlusIcon className="size-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => handleGenerateLink(file.path, true)} className="gap-2">
                                <LinkIcon className="size-4" /> 다운로드 링크 복사
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  navigator.clipboard.writeText(file.publicUrl).then(() => toast.success("링크 복사"));
                                }}
                                className="gap-2"
                              >
                                <CopyIcon className="size-4" /> 공개 URL 복사
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setRenameTarget(file);
                                  setRenameValue(file.name);
                                }}
                                className="gap-2"
                              >
                                <FolderPlusIcon className="size-4" /> 이름 변경
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDelete(file.path)} className="gap-2 text-destructive">
                                <Trash2Icon className="size-4" /> 삭제
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <div className="hidden rounded-2xl border border-pink-200/80 bg-white/95 p-3 shadow-md sm:block">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">파일 · 폴더 업로드</h2>
                <p className="text-sm text-muted-foreground">드래그하거나 선택해서 {currentLabel || "루트"}로 저장하세요.</p>
              </div>
              <UploadCloudIcon className="size-5 text-rose-400" />
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <form className="space-y-3 rounded-2xl border border-pink-100 p-3" onSubmit={handleFileUploadSubmit}>
                <input type="hidden" name="folder" value={currentFolder} />
                <div
                  className={`rounded-2xl border-2 border-dashed p-5 text-center transition ${fileDropActive ? "border-rose-400 bg-rose-50" : "border-pink-200"}`}
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

              <form className="space-y-3 rounded-2xl border border-pink-100 p-3" onSubmit={handleFolderUploadSubmit}>
                <input type="hidden" name="folder" value={currentFolder} />
                <div
                  className={`rounded-2xl border-2 border-dashed p-5 text-center transition ${folderDropActive ? "border-rose-400 bg-rose-50" : "border-pink-200"}`}
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
          </div>
        </main>
      </div>

      <div className="fixed bottom-3 left-1/2 z-20 w-full max-w-md -translate-x-1/2 px-4 sm:hidden">
        <div className="rounded-2xl border border-pink-200/70 bg-white/95 px-3 py-3 shadow-md">
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

      <Dialog open={Boolean(previewFile)} onOpenChange={(open) => (!open ? setPreviewFile(null) : null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{previewFile?.name}</DialogTitle>
            <DialogDescription>{previewFile ? formatSize(previewFile.size) : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-2xl border border-dashed border-pink-200 p-4 text-sm">
            <p className="text-muted-foreground">다운로드 링크를 새 탭에서 열거나 복사해 주세요.</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => previewFile && handleGenerateLink(previewFile.path, false)}
              >
                다운로드 열기
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => previewFile && handleGenerateLink(previewFile.path, true)}
              >
                링크 복사
              </Button>
            </div>
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
