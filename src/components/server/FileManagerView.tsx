"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Folder,
  FolderOpen,
  File,
  Plus,
  FolderPlus,
  Upload,
  Download,
  Trash2,
  Copy,
  Archive,
  FileArchive,
  Search,
  CheckSquare,
  Square,
  Edit2,
  RefreshCw,
  ChevronRight,
  ArrowLeft,
  X,
} from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { CodeEditorModal } from "./CodeEditorModal";

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  updatedAt: string;
  extension: string;
}

interface FileManagerViewProps {
  serverId: string;
}

export function FileManagerView({ serverId }: FileManagerViewProps) {
  const [currentPath, setCurrentPath] = useState("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Modal states
  const [editorFile, setEditorFile] = useState<{ path: string; content: string } | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showCreateFile, setShowCreateFile] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<FileList | null>(null);
  const [uploading, setUploading] = useState(false);

  // Rename / Copy / Compress state
  const [renameItem, setRenameItem] = useState<FileItem | null>(null);
  const [renameNewName, setRenameNewName] = useState("");
  const [compressName, setCompressName] = useState("");
  const [showCompress, setShowCompress] = useState(false);
  const [showRelocate, setShowRelocate] = useState<null | "copy">(null);
  const [relocateDestination, setRelocateDestination] = useState("");
  const [relocating, setRelocating] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [extractNoticeVisible, setExtractNoticeVisible] = useState(false);
  const [openNotice, setOpenNotice] = useState<string | null>(null);
  const [currentProjectRoot, setCurrentProjectRoot] = useState("/home/container");
  const uploadXhrRef = useRef<XMLHttpRequest | null>(null);

  const fetchProjectRoot = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/servers/${serverId}`);
      const data = await res.json();
      if (data.success) {
        setCurrentProjectRoot(data.data.workingDirectory || "/home/container");
      }
    } catch (err) {
      console.error(err);
    }
  }, [serverId]);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/files/list?path=${encodeURIComponent(currentPath)}`);
      const data = await res.json();
      if (data.success) {
        setFiles(data.data || []);
      }
      await fetchProjectRoot();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [serverId, currentPath, fetchProjectRoot]);

  useEffect(() => {
    fetchFiles();
    setSelectedPaths(new Set());
  }, [fetchFiles]);

  const handleOpenFolder = (folderRelPath: string) => {
    setCurrentPath(folderRelPath);
  };

  const handleOpenFile = async (fileRelPath: string) => {
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/files/read?path=${encodeURIComponent(fileRelPath)}`);
      const data = await res.json();
      if (data.success) {
        setEditorFile({ path: fileRelPath, content: data.data.content });
      } else {
        alert(data.error?.message || "Failed to read file");
      }
    } catch (err) {
      alert("Failed to open file");
    }
  };

  const handleOpenProjectRoot = async (folderRelPath: string) => {
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderRelPath }),
      });
      const data = await res.json();
      if (data.success) {
        setCurrentProjectRoot(data.data.workingDirectory || "/home/container");
        setOpenNotice(
          `Folder dibuka sebagai project root. MAIN_FILE terdeteksi: ${data.data.mainFile}${
            data.data.hasPackageJson ? " • package.json ditemukan" : ""
          }`
        );
        setTimeout(() => setOpenNotice(null), 6000);
      } else {
        alert(data.error?.message || "Failed to open project folder");
      }
    } catch {
      alert("Failed to open project folder");
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;

    const fullRelPath = currentPath ? `${currentPath}/${newItemName}` : newItemName;
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/files/create-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fullRelPath }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreateFolder(false);
        setNewItemName("");
        fetchFiles();
      } else {
        alert(data.error?.message || "Failed to create folder");
      }
    } catch {
      alert("Error creating folder");
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) return;

    const fullRelPath = currentPath ? `${currentPath}/${newItemName}` : newItemName;
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/files/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fullRelPath, content: "" }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreateFile(false);
        setNewItemName("");
        fetchFiles();
        handleOpenFile(fullRelPath);
      } else {
        alert(data.error?.message || "Failed to create file");
      }
    } catch {
      alert("Error creating file");
    }
  };

  const handleDelete = async (pathsToDelete: string[]) => {
    if (!confirm(`Are you sure you want to delete ${pathsToDelete.length} item(s)?`)) return;

    try {
      const res = await fetch(`/api/v1/servers/${serverId}/files/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: pathsToDelete }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedPaths(new Set());
        fetchFiles();
      } else {
        alert(data.error?.message || "Delete failed");
      }
    } catch {
      alert("Delete failed");
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameItem || !renameNewName.trim()) return;

    const parentDir = currentPath;
    const newRelPath = parentDir ? `${parentDir}/${renameNewName}` : renameNewName;

    try {
      const res = await fetch(`/api/v1/servers/${serverId}/files/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPath: renameItem.path, newPath: newRelPath }),
      });
      const data = await res.json();
      if (data.success) {
        setRenameItem(null);
        setRenameNewName("");
        fetchFiles();
      } else {
        alert(data.error?.message || "Rename failed");
      }
    } catch {
      alert("Rename failed");
    }
  };

  const handleCompress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedPaths.size === 0 || !compressName.trim()) return;

    try {
      const res = await fetch(`/api/v1/servers/${serverId}/files/compress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: Array.from(selectedPaths),
          archiveName: compressName,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCompress(false);
        setCompressName("");
        setSelectedPaths(new Set());
        fetchFiles();
      } else {
        alert(data.error?.message || "Compression failed");
      }
    } catch {
      alert("Compression failed");
    }
  };

  const handleExtract = async (fileRelPath: string) => {
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/files/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archivePath: fileRelPath,
          targetFolder: currentPath,
        }),
      });
      const data = await res.json();
      if (data.success) {
        fetchFiles();
        setExtractNoticeVisible(true);
        setTimeout(() => setExtractNoticeVisible(false), 7000);
      } else {
        alert(data.error?.message || "Extraction failed");
      }
    } catch {
      alert("Extraction failed");
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFiles || uploadFiles.length === 0) return;

    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("directory", currentPath);
    for (let i = 0; i < uploadFiles.length; i++) {
      formData.append("files", uploadFiles[i]);
    }

    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadXhrRef.current = xhr;
        xhr.open("POST", `/api/v1/servers/${serverId}/files/upload`);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && data.success) {
              resolve();
            } else {
              reject(new Error(data.error?.message || "Upload failed"));
            }
          } catch {
            reject(new Error("Upload response parse failed"));
          }
        };
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.onabort = () => reject(new Error("UPLOAD_CANCELLED"));
        xhr.send(formData);
      });

      setShowUpload(false);
      setUploadFiles(null);
      setUploadProgress(0);
      fetchFiles();
    } catch (error) {
      if (error instanceof Error && error.message === "UPLOAD_CANCELLED") {
        alert("Upload dibatalkan.");
      } else if (error instanceof Error) {
        alert(error.message);
      } else {
        alert("Upload failed");
      }
    } finally {
      uploadXhrRef.current = null;
      setUploading(false);
    }
  };

  const handleCancelUpload = () => {
    uploadXhrRef.current?.abort();
  };

  const handleRelocateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showRelocate || !relocateDestination.trim() || selectedPaths.size === 0) return;

    const resolveDestinationDir = (input: string) => {
      const raw = input.trim();
      if (raw.startsWith("/")) {
        return raw.replace(/^\/+/, "");
      }

      const base = currentPath ? `${currentPath}/${raw}` : raw;
      const parts = base.split("/");
      const resolved: string[] = [];
      for (const part of parts) {
        if (!part || part === ".") continue;
        if (part === "..") {
          resolved.pop();
          continue;
        }
        resolved.push(part);
      }
      return resolved.join("/");
    };

    setRelocating(true);
    try {
      const selectedItems = Array.from(selectedPaths);
      for (const srcPath of selectedItems) {
        const fileName = srcPath.split("/").pop() || srcPath;
        const normalizedDestDir = resolveDestinationDir(relocateDestination);
        const destPath = normalizedDestDir ? `${normalizedDestDir}/${fileName}` : fileName;

        const endpoint = "copy";
        const res = await fetch(`/api/v1/servers/${serverId}/files/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ srcPath, destPath }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error?.message || `${showRelocate} failed`);
        }
      }

      setShowRelocate(null);
      setRelocateDestination("");
      setSelectedPaths(new Set());
      fetchFiles();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Copy failed");
    } finally {
      setRelocating(false);
    }
  };

  const toggleSelect = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedPaths.size === filteredFiles.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(filteredFiles.map((f) => f.path)));
    }
  };

  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const pathBreadcrumbs = currentPath.split("/").filter(Boolean);

  return (
    <div className="space-y-4">
      {extractNoticeVisible && (
        <div className="fixed top-4 right-4 z-50 max-w-sm rounded-2xl border border-white/20 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur text-white">
          <div className="text-sm font-bold">Birdserver sudah membaca file mu, langsung start saja</div>
          <div className="mt-2 text-xs text-zinc-300">BimzOfficial</div>
          <div className="mt-1 text-xs text-zinc-400">pesan dari BimzOfficial Developer Birdserver= SIKIKKKK AYAAAA!!!</div>
        </div>
      )}

      {openNotice && (
        <div className="fixed top-4 left-4 z-50 max-w-md rounded-2xl border border-emerald-500/20 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur text-white">
          <div className="text-sm font-bold text-emerald-400">Open project root berhasil</div>
          <div className="mt-1 text-xs text-zinc-300">{openNotice}</div>
        </div>
      )}
      {/* File Manager Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-zinc-900 border border-zinc-800 rounded-2xl">
        <div className="flex items-center space-x-2 overflow-x-auto text-xs font-mono">
          <button
            onClick={() => setCurrentPath("")}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-bold transition-colors"
          >
            /root
          </button>
          {pathBreadcrumbs.map((crumb, idx) => {
            const pathUpTo = pathBreadcrumbs.slice(0, idx + 1).join("/");
            return (
              <React.Fragment key={pathUpTo}>
                <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                <button
                  onClick={() => setCurrentPath(pathUpTo)}
                  className="px-2 py-1 rounded hover:bg-zinc-800 text-zinc-300 hover:text-white"
                >
                  {crumb}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <button
            onClick={() => setCurrentPath((prev) => prev.split("/").slice(0, -1).join("/"))}
            disabled={!currentPath}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 text-white font-bold text-xs border border-zinc-700 hover:bg-zinc-700 transition-all disabled:opacity-40"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Up
          </button>
          <button
            onClick={() => setShowCreateFile(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-black font-bold text-xs hover:bg-zinc-200 transition-all shadow-[0_0_10px_rgba(255,255,255,0.2)]"
          >
            <Plus className="w-3.5 h-3.5" />
            New File
          </button>
          <button
            onClick={() => setShowCreateFolder(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 text-white font-bold text-xs border border-zinc-700 hover:bg-zinc-700 transition-all"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            New Folder
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 text-white font-bold text-xs border border-zinc-700 hover:bg-zinc-700 transition-all"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload
          </button>
          <button
            onClick={fetchFiles}
            className="p-1.5 rounded-xl bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700 hover:bg-zinc-700 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="px-1">
        <div className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-[11px] text-zinc-300 font-mono">
          <span className="text-zinc-500">Active project root:</span>
          <span className="text-white font-bold">{currentProjectRoot}</span>
          <button
            onClick={() => handleOpenProjectRoot(currentPath)}
            className="ml-2 inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-black hover:bg-zinc-200"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Open current folder
          </button>
        </div>
      </div>

      {/* Bulk Action & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files in directory..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-zinc-600"
          />
        </div>

        {selectedPaths.size > 0 && (
          <div className="flex items-center space-x-2 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-xl text-xs font-semibold text-white w-full sm:w-auto justify-between sm:justify-start">
            <span>{selectedPaths.size} selected</span>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  setShowRelocate("copy");
                  setRelocateDestination(currentPath);
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
              >
                <Copy className="w-3.5 h-3.5" /> Copy
              </button>
              <button
                onClick={() => setShowCompress(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
              >
                <Archive className="w-3.5 h-3.5" /> Compress
              </button>
              <button
                onClick={() => handleDelete(Array.from(selectedPaths))}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-red-950 text-red-400 border border-red-800/80 hover:bg-red-900"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Files Table */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900/80 border-b border-zinc-800 text-zinc-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="p-3.5 w-10 text-center">
                  <button onClick={toggleSelectAll} className="p-1 hover:text-white">
                    {selectedPaths.size === filteredFiles.length && filteredFiles.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-white" />
                    ) : (
                      <Square className="w-4 h-4 text-zinc-600" />
                    )}
                  </button>
                </th>
                <th className="p-3.5">Name</th>
                <th className="p-3.5 w-28">Size</th>
                <th className="p-3.5 w-40">Modified</th>
                <th className="p-3.5 w-28 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-500 italic">
                    Loading directory items...
                  </td>
                </tr>
              ) : filteredFiles.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-500 italic">
                    No files or directories found in this path.
                  </td>
                </tr>
              ) : (
                filteredFiles.map((file) => {
                  const isSelected = selectedPaths.has(file.path);
                  const isArchive = ["zip", "tar", "gz", "tgz"].includes(file.extension);

                  return (
                    <tr
                      key={file.path}
                      className={`hover:bg-zinc-900/50 transition-colors ${
                        isSelected ? "bg-zinc-900/80" : ""
                      }`}
                    >
                      <td className="p-3.5 text-center">
                        <button onClick={() => toggleSelect(file.path)} className="p-1">
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-white" />
                          ) : (
                            <Square className="w-4 h-4 text-zinc-600 hover:text-zinc-400" />
                          )}
                        </button>
                      </td>

                      <td className="p-3.5">
                        <div className="flex items-center space-x-2.5">
                          {file.isDirectory ? (
                            <Folder className="w-4 h-4 text-amber-400 fill-amber-400/20" />
                          ) : isArchive ? (
                            <FileArchive className="w-4 h-4 text-purple-400" />
                          ) : (
                            <File className="w-4 h-4 text-zinc-400" />
                          )}

                          <button
                            onClick={() =>
                              file.isDirectory
                                ? handleOpenFolder(file.path)
                                : handleOpenFile(file.path)
                            }
                            className="font-medium text-white hover:underline text-left font-mono"
                          >
                            {file.name}
                          </button>
                        </div>
                      </td>

                      <td className="p-3.5 text-zinc-400 font-mono">
                        {file.isDirectory ? "-" : formatBytes(file.size)}
                      </td>

                      <td className="p-3.5 text-zinc-400 font-mono text-[11px]">
                        {new Date(file.updatedAt).toLocaleString()}
                      </td>

                      <td className="p-3.5 text-right">
                        <div className="flex items-center justify-end space-x-1">
                          {file.isDirectory && (
                            <button
                              onClick={() => handleOpenProjectRoot(file.path)}
                              className="p-1 text-emerald-400 hover:bg-emerald-950/40 rounded"
                              title="Open as Project Root"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isArchive && (
                            <button
                              onClick={() => handleExtract(file.path)}
                              className="p-1 text-purple-400 hover:bg-purple-950/50 rounded"
                              title="Extract Archive"
                            >
                              <FileArchive className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <a
                            href={`/api/v1/servers/${serverId}/files/download?path=${encodeURIComponent(
                              file.path
                            )}`}
                            download
                            className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded"
                            title="Download"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                          <button
                            onClick={() => {
                              setSelectedPaths(new Set([file.path]));
                              setShowRelocate("copy");
                              setRelocateDestination(currentPath);
                            }}
                            className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded"
                            title="Copy"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              setRenameItem(file);
                              setRenameNewName(file.name);
                            }}
                            className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded"
                            title="Rename"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete([file.path])}
                            className="p-1 text-red-400 hover:bg-red-950/50 rounded"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Code Editor Modal */}
      {editorFile && (
        <CodeEditorModal
          serverId={serverId}
          filePath={editorFile.path}
          initialContent={editorFile.content}
          onClose={() => setEditorFile(null)}
          onSaved={() => fetchFiles()}
        />
      )}

      {/* Create File / Folder Modal */}
      {(showCreateFile || showCreateFolder) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-4">
              {showCreateFile ? "Create New File" : "Create New Folder"}
            </h3>
            <form onSubmit={showCreateFile ? handleCreateFile : handleCreateFolder} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                  Name
                </label>
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder={showCreateFile ? "app.js" : "my-folder"}
                  required
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600 font-mono"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateFile(false);
                    setShowCreateFolder(false);
                    setNewItemName("");
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-4">Upload Files</h3>
            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div className="border-2 border-dashed border-zinc-800 rounded-2xl p-6 text-center bg-zinc-900/50">
                <Upload className="w-8 h-8 mx-auto text-zinc-500 mb-2" />
                <input
                  type="file"
                  multiple
                  onChange={(e) => setUploadFiles(e.target.files)}
                  className="w-full text-xs text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-white file:text-black hover:file:bg-zinc-200"
                />
                <p className="mt-3 text-[11px] text-zinc-500">
                  Tidak ada hard cap 2GB di UI Birdserver. Batas upload mengikuti proxy/server/storage yang tersedia.
                </p>
              </div>
              {uploading && (
                <div className="space-y-2">
                  <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-white transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <div className="text-[11px] text-zinc-400 font-mono">Upload progress: {uploadProgress}%</div>
                </div>
              )}
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => (uploading ? handleCancelUpload() : setShowUpload(false))}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                >
                  {uploading ? "Batalkan Upload" : "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={uploading || !uploadFiles}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 disabled:opacity-50"
                >
                  {uploading ? "Uploading..." : "Start Upload"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-4">Rename Item</h3>
            <form onSubmit={handleRenameSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                  New Name
                </label>
                <input
                  type="text"
                  value={renameNewName}
                  onChange={(e) => setRenameNewName(e.target.value)}
                  required
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600 font-mono"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setRenameItem(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200"
                >
                  Save Rename
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Copy Modal */}
      {showRelocate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-4">
              Copy Selected Items
            </h3>
            <form onSubmit={handleRelocateSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                  Destination Directory
                </label>
                <input
                  type="text"
                  value={relocateDestination}
                  onChange={(e) => setRelocateDestination(e.target.value)}
                  placeholder="contoh: /src atau ../src"
                  required
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600 font-mono"
                />
                <p className="mt-2 text-[11px] text-zinc-500">
                  Mendukung path ala Pterodactyl: root-relative <span className="font-mono text-zinc-300">/src</span> atau relative <span className="font-mono text-zinc-300">../src</span> dari folder saat ini.
                </p>
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRelocate(null);
                    setRelocateDestination("");
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={relocating}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 disabled:opacity-50"
                >
                  {relocating ? "Processing..." : "Copy Items"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Compress Modal */}
      {showCompress && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-base font-bold text-white mb-4">Compress Selected Items</h3>
            <form onSubmit={handleCompress} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                  Archive File Name (.zip)
                </label>
                <input
                  type="text"
                  value={compressName}
                  onChange={(e) => setCompressName(e.target.value)}
                  placeholder="archive.zip"
                  required
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600 font-mono"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowCompress(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200"
                >
                  Compress
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
