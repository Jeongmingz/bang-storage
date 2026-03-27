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
  deleteFileAction,
  deleteFolderAction,
  generateDownloadLink,
  logout,
  refreshFiles,
  uploadFiles,
} from "@/app/actions";
import type { StorageSnapshot } from "@/lib/storage";
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

import { Badge } from "@/components/ui/badge";

type Props = {
  initialSnapshot: StorageSnapshot;
  bucketName: string;
};

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
  const [uploadPending, startUpload] = useTransition();
  const [isMutating, startMutate] = useTransition();
  const [isRefreshing, startRefreshing] = useTransition();
  const [progress, setProgress] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [newFolder, setNewFolder] = useState("");
  const uploadFormRef = useRef<HTMLFormElement>(null);

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

  useEffect(() => {
    if (!uploadPending) {
      return;
    }

    const timer = setInterval(() => {
      setProgress((value) => (value >= 90 ? value : value + Math.ceil(Math.random() * 8)));
    }, 260);

    return () => {
      clearInterval(timer);
      setProgress(0);
    };
  }, [uploadPending]);

  const handleSnapshotUpdate = (next: StorageSnapshot, nextBucket?: string) => {
    setSnapshot(next);
    setCurrentFolder(next.path ?? DEFAULT_FOLDER);
    if (nextBucket) {
      setBucket(nextBucket);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(event.target.files ?? []);
    setSelectedFiles(list.map((file) => `${file.name} · ${formatSize(file.size)}`));
  };

  const handleUpload = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setProgress(12);

    startUpload(() => {
      uploadFiles(formData).then((result) => {
        if (result.success && result.snapshot) {
          handleSnapshotUpdate(result.snapshot);
          form.reset();
          setSelectedFiles([]);
          toast.success(result.message ?? "업로드 완료");
        } else if (!result.success) {
          toast.error(result.message);
          handleUnauthorized(result.message);
        }
      });
    });
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

  const handleGenerateLink = (path: string) => {
    startMutate(() => {
      generateDownloadLink(path).then(async (result) => {
        if (result.success && result.url) {
          try {
            await navigator.clipboard.writeText(result.url);
            toast.info("다운로드 링크를 복사했습니다.");
          } catch {
            window.open(result.url, "_blank");
            toast.success("새 탭에서 열렸습니다.");
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

  const totalFolders = folders.length;
  const isRoot = !currentFolder;
  const currentLabel = currentFolder || "루트";
  const composePath = (folderName: string) =>
    (currentFolder ? `${currentFolder}/${folderName}` : folderName).replace(/\/+/, "/");

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
              <p className="text-xs uppercase tracking-[0.3em] text-rose-400">Bucket</p>
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

        <main className="flex flex-1 flex-col gap-4">
          <div className="rounded-3xl border border-pink-200/80 bg-white/90 p-4 shadow-lg">
            <div className="flex flex-wrap items-center gap-2">
              {breadcrumbItems.map((item, idx) => (
                <div key={item.path || idx} className="flex items-center gap-1 text-sm">
                  {idx > 0 && <span className="text-muted-foreground">/</span>}
                  <button
                    type="button"
                    onClick={() => handleRefresh(item.path)}
                    className={`rounded-full px-2 py-1 ${currentFolder === item.path ? "bg-rose-100 text-rose-600" : "text-muted-foreground"}`}
                  >
                    {item.label}
                  </button>
                </div>
              ))}
              <Button
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

          <div className="rounded-3xl border border-pink-200/80 bg-white/90 p-4 shadow-lg">
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
              <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-pink-200 px-6 py-12 text-center">
                <FolderIcon className="size-8 text-rose-300" />
                <p className="font-medium">비어 있어요. 파일을 업로드해 보세요.</p>
                <p className="text-sm text-muted-foreground">새 폴더를 만들고 소중한 순간을 채워보세요.</p>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {files.map((file) => (
                  <div key={file.id} className="rounded-2xl border border-pink-100 bg-gradient-to-br from-white via-rose-50 to-pink-50 p-4 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatSize(file.size)} · {formatRelative(file.updatedAt)}
                        </p>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-rose-100">
                          <PlusIcon className="size-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem onClick={() => handleGenerateLink(file.path)} className="gap-2">
                            <LinkIcon className="size-4" /> 링크 복사
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              navigator.clipboard.writeText(file.name).then(() => toast.success("이름 복사됨"));
                            }}
                            className="gap-2"
                          >
                            <CopyIcon className="size-4" /> 이름 복사
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDelete(file.path)} className="gap-2 text-destructive">
                            <Trash2Icon className="size-4" /> 삭제
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <Badge variant="secondary" className="mt-4">
                      {file.contentType ?? "파일"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-pink-200/80 bg-white/90 p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">파일 업로드</h2>
                <p className="text-sm text-muted-foreground">{currentLabel} 폴더로 저장됩니다.</p>
              </div>
              <UploadCloudIcon className="size-5 text-rose-400" />
            </div>
            <form ref={uploadFormRef} className="mt-4 space-y-4" onSubmit={handleUpload}>
              <input type="hidden" name="folder" value={currentFolder} />
              <div className="space-y-2">
                <Label htmlFor="files">파일 선택</Label>
                <Input id="files" name="files" type="file" multiple required onChange={handleFileChange} disabled={uploadPending} />
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {selectedFiles.length === 0 ? (
                    <li>선택된 파일이 없습니다.</li>
                  ) : (
                    selectedFiles.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)
                  )}
                </ul>
              </div>
              {uploadPending && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>업로드 중...</span>
                    <span>{progress}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>
              )}
              <Button type="submit" className="w-full" disabled={uploadPending}>
                업로드
              </Button>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
