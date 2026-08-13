"use client";

import React, { useState } from "react";
import Editor from "@monaco-editor/react";
import { Save, X, FileCode, Check } from "lucide-react";

interface CodeEditorModalProps {
  serverId: string;
  filePath: string;
  initialContent: string;
  onClose: () => void;
  onSaved?: () => void;
}

export function CodeEditorModal({
  serverId,
  filePath,
  initialContent,
  onClose,
  onSaved,
}: CodeEditorModalProps) {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Detect language from extension
  const getLanguage = (pathStr: string) => {
    const ext = pathStr.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "js":
      case "jsx":
        return "javascript";
      case "ts":
      case "tsx":
        return "typescript";
      case "json":
        return "json";
      case "py":
        return "python";
      case "php":
        return "php";
      case "yaml":
      case "yml":
        return "yaml";
      case "sh":
      case "bash":
        return "shell";
      case "html":
        return "html";
      case "css":
        return "css";
      case "env":
        return "ini";
      default:
        return "plaintext";
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/servers/${serverId}/files/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content }),
      });
      const data = await res.json();
      if (data.success) {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 2000);
        if (onSaved) onSaved();
      } else {
        alert(data.error?.message || "Failed to save file");
      }
    } catch (err) {
      alert("Failed to save file");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
      <div className="bg-zinc-950 border border-zinc-800 w-full max-w-5xl h-[85vh] rounded-2xl flex flex-col shadow-2xl overflow-hidden">
        {/* Editor Modal Header */}
        <div className="bg-zinc-900 px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <FileCode className="w-5 h-5 text-white" />
            <div>
              <h3 className="text-sm font-bold text-white font-mono">{filePath}</h3>
              <p className="text-[11px] text-zinc-400">Syntax Mode: {getLanguage(filePath)}</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {savedSuccess && (
              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                <Check className="w-4 h-4" /> Saved!
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-white text-black hover:bg-zinc-200 transition-all shadow-[0_0_10px_rgba(255,255,255,0.3)] disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving..." : "Save File"}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Monaco Editor Container */}
        <div className="flex-1 bg-zinc-950">
          <Editor
            height="100%"
            theme="vs-dark"
            language={getLanguage(filePath)}
            value={content}
            onChange={(value) => setContent(value || "")}
            options={{
              fontSize: 13,
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              fontFamily: "JetBrains Mono, Fira Code, monospace",
            }}
          />
        </div>
      </div>
    </div>
  );
}
