import React, { useRef, useState } from 'react';
import type { WordCreate } from '../../shared/domain/types';
import { importWordsApi } from '../../api/dictionary';

interface DictionaryImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onRefresh: () => Promise<void>;
}

export function DictionaryImportModal({
  isOpen,
  onClose,
  onSuccess,
  onRefresh,
}: DictionaryImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedWords, setParsedWords] = useState<WordCreate[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mode, setMode] = useState<'merge' | 'overwrite'>('merge');
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setParseError(null);
    setParsedWords([]);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const json = JSON.parse(text);
        let items: unknown[] = [];
        if (Array.isArray(json)) {
          items = json;
        } else if (json && typeof json === 'object') {
          if (Array.isArray((json as Record<string, unknown>).words)) {
            items = (json as Record<string, unknown>).words as unknown[];
          } else if (Array.isArray((json as Record<string, unknown>).data)) {
            items = (json as Record<string, unknown>).data as unknown[];
          } else if (Array.isArray((json as Record<string, unknown>).items)) {
            items = (json as Record<string, unknown>).items as unknown[];
          }
        }

        const valid: WordCreate[] = [];
        for (const item of items) {
          if (!item || typeof item !== 'object') continue;
          const obj = item as Record<string, unknown>;
          const surface =
            typeof obj.surface === 'string'
              ? obj.surface
              : typeof obj.word === 'string'
                ? obj.word
                : typeof obj.text === 'string'
                  ? obj.text
                  : '';
          if (!surface.trim()) continue;

          valid.push({
            surface: surface.trim(),
            translation:
              typeof obj.translation === 'string'
                ? obj.translation
                : undefined,
            phonetic:
              typeof obj.phonetic === 'string' ? obj.phonetic : undefined,
            context:
              typeof obj.context === 'string' ? obj.context : '',
            contextTranslation:
              typeof obj.contextTranslation === 'string'
                ? obj.contextTranslation
                : undefined,
            explanation:
              typeof obj.explanation === 'string'
                ? obj.explanation
                : undefined,
            explainEngine:
              obj.explainEngine === 'llm' ||
              obj.explainEngine === 'free_mt' ||
              obj.explainEngine === 'manual' ||
              obj.explainEngine === 'none'
                ? obj.explainEngine
                : undefined,
            explainProvider:
              typeof obj.explainProvider === 'string'
                ? obj.explainProvider
                : undefined,
            kind: obj.kind === 'sentence' ? 'sentence' : 'word',
            sourceUrl:
              typeof obj.sourceUrl === 'string' ? obj.sourceUrl : undefined,
            sourceTitle:
              typeof obj.sourceTitle === 'string' ? obj.sourceTitle : undefined,
            cueStartMs:
              typeof obj.cueStartMs === 'number' ? obj.cueStartMs : undefined,
            cueEndMs:
              typeof obj.cueEndMs === 'number' ? obj.cueEndMs : undefined,
            tags: Array.isArray(obj.tags)
              ? obj.tags.filter((t): t is string => typeof t === 'string')
              : undefined,
            learningStatus:
              obj.learningStatus === 'learning' ||
              obj.learningStatus === 'learned'
                ? obj.learningStatus
                : 'new',
            reviewStage:
              typeof obj.reviewStage === 'number' ? obj.reviewStage : 0,
            nextReviewAt:
              typeof obj.nextReviewAt === 'number'
                ? obj.nextReviewAt
                : Date.now(),
            createdAt:
              typeof obj.createdAt === 'number' ? obj.createdAt : Date.now(),
          });
        }

        if (valid.length === 0) {
          setParseError('未在文件中识别到有效的单词数据，请检查文件格式。');
        } else {
          setParsedWords(valid);
        }
      } catch (err) {
        setParseError(
          `JSON 解析失败: ${err instanceof Error ? err.message : '无效的文件格式'}`,
        );
      }
    };
    reader.onerror = () => {
      setParseError('读取文件失败，请重新选择。');
    };
    reader.readAsText(selectedFile);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const dropFile = e.dataTransfer.files[0];
      if (dropFile) {
        handleFileSelect(dropFile);
      }
    }
  };

  const handleStartImport = async () => {
    if (parsedWords.length === 0 || importing) return;
    if (
      mode === 'overwrite' &&
      !window.confirm('确定要清空现有生词本并完全覆盖吗？此操作不可撤销。')
    ) {
      return;
    }

    setImporting(true);
    try {
      const res = await importWordsApi(parsedWords, mode);
      await onRefresh();
      onSuccess(
        `✓ 成功导入 ${res.total} 条生词（新增 ${res.added}，更新 ${res.updated}）`,
      );
      handleResetAndClose();
    } catch (err) {
      setParseError(
        `导入失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setImporting(false);
    }
  };

  const handleResetAndClose = () => {
    setFile(null);
    setParsedWords([]);
    setParseError(null);
    setImporting(false);
    setMode('merge');
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleResetAndClose}>
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-import-title"
      >
        <div className="modal-header">
          <h3 id="modal-import-title" style={{ margin: 0 }}>
            导入生词本 JSON
          </h3>
          <button
            type="button"
            className="modal-close"
            onClick={handleResetAndClose}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          <input
            type="file"
            ref={fileInputRef}
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileSelect(e.target.files[0]);
              }
            }}
          />

          <div
            className={`dropzone ${dragOver ? 'drag-over' : ''} ${
              file ? 'has-file' : ''
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {file ? (
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  📄 {file.name}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {(file.size / 1024).toFixed(1)} KB · 点击重新选择
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 24, marginBottom: 8 }}>📥</div>
                <div>拖拽 JSON 文件到此处，或点击选择文件</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  支持由 UniEnglishHelper 导出的 JSON 生词格式
                </div>
              </div>
            )}
          </div>

          {parseError && (
            <div className="import-alert import-alert-error">{parseError}</div>
          )}

          {parsedWords.length > 0 && (
            <>
              <div className="import-alert import-alert-success">
                已成功识别 <strong>{parsedWords.length}</strong> 条有效词条
              </div>

              <div style={{ marginTop: 14 }}>
                <label style={{ fontWeight: 600, marginBottom: 6, display: 'block' }}>
                  导入模式
                </label>
                <div style={{ display: 'flex', gap: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="importMode"
                      value="merge"
                      checked={mode === 'merge'}
                      onChange={() => setMode('merge')}
                    />
                    <span>增量合并 (保留原有，更新重名生词)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="importMode"
                      value="overwrite"
                      checked={mode === 'overwrite'}
                      onChange={() => setMode('overwrite')}
                    />
                    <span>完全覆盖 (清空现有词库)</span>
                  </label>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <label style={{ fontWeight: 600, marginBottom: 6, display: 'block' }}>
                  词条预览 (前 {Math.min(5, parsedWords.length)} 条)
                </label>
                <div className="import-preview-list">
                  {parsedWords.slice(0, 5).map((w, idx) => (
                    <div key={idx} className="import-preview-item">
                      <div style={{ fontWeight: 600 }}>{w.surface}</div>
                      {w.translation && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {w.translation.slice(0, 80)}
                        </div>
                      )}
                      {w.context && (
                        <div className="muted" style={{ fontSize: 11 }}>
                          上下文: {w.context.slice(0, 80)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="ghost"
            onClick={handleResetAndClose}
            disabled={importing}
          >
            取消
          </button>
          <button
            type="button"
            className="primary"
            disabled={parsedWords.length === 0 || importing}
            onClick={() => void handleStartImport()}
          >
            {importing ? '导入中…' : `开始导入 (${parsedWords.length} 条)`}
          </button>
        </div>
      </div>
    </div>
  );
}
