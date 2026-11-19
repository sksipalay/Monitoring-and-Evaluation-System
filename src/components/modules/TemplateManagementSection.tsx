import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  FileCode2,
  FileSpreadsheet,
  FileText,
  History,
  Lock,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  DocumentTemplate,
  DocumentTemplateVersion,
  TemplateAnalysisSummary,
  TemplateFormat,
  TemplateReportTarget,
} from '../../types/ppa';
import { dataService } from '../../services/dataService';
import {
  TEMPLATE_TARGET_LABELS,
  analyzeTemplateBuffer,
  arrayBufferToBase64,
} from '../../utils/templateEngine';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface TemplateManagementSectionProps {
  isAdmin: boolean;
  onNotify: (type: 'success' | 'error', msg: string) => void;
}

function getFormatFromFileName(name: string): TemplateFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.pdf')) return 'pdf';
  return null;
}

function FormatBadge({ format }: { format: TemplateFormat }) {
  const styles: Record<TemplateFormat, string> = {
    xlsx: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800',
    docx: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800',
    pdf: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10.5px] font-mono font-semibold uppercase ${styles[format]}`}
    >
      {format === 'xlsx' ? (
        <FileSpreadsheet className="h-3 w-3" aria-hidden="true" />
      ) : (
        <FileText className="h-3 w-3" aria-hidden="true" />
      )}
      {format}
    </span>
  );
}

export function TemplateManagementSection({
  isAdmin,
  onNotify,
}: TemplateManagementSectionProps) {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterFormat, setFilterFormat] = useState<'ALL' | TemplateFormat>('ALL');

  // Upload / New Version Modal State
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [versionTargetTemplate, setVersionTargetTemplate] = useState<DocumentTemplate | null>(null);
  const [tplName, setTplName] = useState('');
  const [tplDescription, setTplDescription] = useState('');
  const [tplTargetReport, setTplTargetReport] = useState<TemplateReportTarget>('annual_ppa');
  const [tplIsDefault, setTplIsDefault] = useState(true);
  const [tplIsActive, setTplIsActive] = useState(true);
  const [tplNotes, setTplNotes] = useState('');
  const [pickedFile, setPickedFile] = useState<{
    fileName: string;
    mimeType: string;
    format: TemplateFormat;
    fileBase64: string;
    fileSize: number;
    analysis: TemplateAnalysisSummary;
  } | null>(null);
  const [analyzingFile, setAnalyzingFile] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Edit Metadata Modal State
  const [editingTemplate, setEditingTemplate] = useState<DocumentTemplate | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string;
    description: string;
    targetReport: TemplateReportTarget;
    isDefault: boolean;
    isActive: boolean;
  }>({
    name: '',
    description: '',
    targetReport: 'annual_ppa',
    isDefault: false,
    isActive: true,
  });
  const [savingEdit, setSavingEdit] = useState(false);

  // Inspect / History / Preview Modal State
  const [inspectTemplate, setInspectTemplate] = useState<DocumentTemplate | null>(null);
  const [inspectPdfUrl, setInspectPdfUrl] = useState<string | null>(null);
  const [loadingInspectPdf, setLoadingInspectPdf] = useState(false);
  const [confirmDeleteTpl, setConfirmDeleteTpl] = useState<DocumentTemplate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadModalRef = useModalFocusTrap<HTMLDivElement>(uploadModalOpen, () =>
    setUploadModalOpen(false)
  );
  const editModalRef = useModalFocusTrap<HTMLDivElement>(Boolean(editingTemplate), () =>
    setEditingTemplate(null)
  );
  const inspectModalRef = useModalFocusTrap<HTMLDivElement>(Boolean(inspectTemplate), () =>
    setInspectTemplate(null)
  );

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const res = await dataService.listTemplates();
      setTemplates(res.templates || []);
    } catch {
      // Keep quiet on initial passive load
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  // Load binary PDF preview if inspecting a PDF template
  useEffect(() => {
    if (!inspectTemplate || inspectTemplate.format !== 'pdf') {
      setInspectPdfUrl(null);
      return;
    }
    let cancelled = false;
    let url: string | null = null;
    setLoadingInspectPdf(true);
    dataService
      .fetchTemplateBinary(inspectTemplate.id, inspectTemplate.currentVersionId)
      .then((buf) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
        setInspectPdfUrl(url);
      })
      .catch(() => {
        if (!cancelled) setInspectPdfUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingInspectPdf(false);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [inspectTemplate]);

  const filteredTemplates = useMemo(
    () =>
      templates.filter((t) => (filterFormat === 'ALL' ? true : t.format === filterFormat)),
    [templates, filterFormat]
  );

  const openNewUploadModal = () => {
    if (!isAdmin) return;
    setVersionTargetTemplate(null);
    setTplName('');
    setTplDescription('');
    setTplTargetReport('annual_ppa');
    setTplIsDefault(true);
    setTplIsActive(true);
    setTplNotes('Initial official template upload');
    setPickedFile(null);
    setUploadModalOpen(true);
  };

  const openNewVersionModal = (tpl: DocumentTemplate) => {
    if (!isAdmin) return;
    setVersionTargetTemplate(tpl);
    setTplName(tpl.name);
    setTplDescription(tpl.description);
    setTplTargetReport(tpl.targetReport);
    setTplIsDefault(tpl.isDefault);
    setTplIsActive(tpl.isActive);
    setTplNotes(`Updated version (v${tpl.currentVersionNumber + 1})`);
    setPickedFile(null);
    setUploadModalOpen(true);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const format = getFormatFromFileName(file.name);
    if (!format) {
      onNotify('error', 'Only .xlsx, .docx, and .pdf official blank templates are supported.');
      return;
    }
    if (versionTargetTemplate && versionTargetTemplate.format !== format) {
      onNotify(
        'error',
        `New version must match the template format (.${versionTargetTemplate.format}).`
      );
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      onNotify('error', 'Template file exceeds the 10 MB limit.');
      return;
    }

    setAnalyzingFile(true);
    try {
      const buf = await file.arrayBuffer();
      const analysis = await analyzeTemplateBuffer(file.name, format, buf);
      const fileBase64 = arrayBufferToBase64(buf);
      setPickedFile({
        fileName: file.name,
        mimeType:
          file.type ||
          (format === 'pdf'
            ? 'application/pdf'
            : format === 'docx'
              ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        format,
        fileBase64,
        fileSize: file.size,
        analysis,
      });
      if (!tplName.trim()) {
        setTplName(file.name.replace(/\.(xlsx|docx|pdf)$/i, '').replace(/[_-]+/g, ' '));
      }
    } catch (err) {
      onNotify(
        'error',
        err instanceof Error ? err.message : 'Unable to analyze selected template file.'
      );
    } finally {
      setAnalyzingFile(false);
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !pickedFile) return;
    if (!tplName.trim()) {
      onNotify('error', 'Template Name is required.');
      return;
    }
    setUploading(true);
    try {
      const res = await dataService.uploadTemplate({
        templateId: versionTargetTemplate?.id,
        name: tplName.trim(),
        description: tplDescription.trim(),
        format: pickedFile.format,
        targetReport: tplTargetReport,
        isDefault: tplIsDefault,
        isActive: tplIsActive,
        fileName: pickedFile.fileName,
        mimeType: pickedFile.mimeType,
        fileBase64: pickedFile.fileBase64,
        notes: tplNotes.trim(),
        analysis: pickedFile.analysis,
      });
      setTemplates((prev) => {
        const exists = prev.some((t) => t.id === res.template.id);
        return exists
          ? prev.map((t) => (t.id === res.template.id ? res.template : t))
          : [res.template, ...prev];
      });
      onNotify(
        'success',
        versionTargetTemplate
          ? `Uploaded v${res.template.currentVersionNumber} for "${res.template.name}".`
          : `Official template "${res.template.name}" uploaded and activated.`
      );
      setUploadModalOpen(false);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to upload official template.');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !editingTemplate) return;
    setSavingEdit(true);
    try {
      const res = await dataService.updateTemplate(editingTemplate.id, editForm);
      setTemplates((prev) => {
        const updated = res.template;
        return prev.map((t) => {
          if (t.id === updated.id) return updated;
          if (
            updated.isDefault &&
            t.format === updated.format &&
            t.targetReport === updated.targetReport
          ) {
            return { ...t, isDefault: false };
          }
          return t;
        });
      });
      onNotify('success', `Updated template "${res.template.name}".`);
      setEditingTemplate(null);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to update template.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSetDefault = async (tpl: DocumentTemplate) => {
    if (!isAdmin) return;
    setBusyId(tpl.id);
    try {
      const res = await dataService.updateTemplate(tpl.id, {
        isDefault: true,
        isActive: true,
      });
      setTemplates((prev) =>
        prev.map((t) => {
          if (t.id === res.template.id) return res.template;
          if (t.format === res.template.format && t.targetReport === res.template.targetReport) {
            return { ...t, isDefault: false };
          }
          return t;
        })
      );
      onNotify('success', `"${tpl.name}" set as default for ${TEMPLATE_TARGET_LABELS[tpl.targetReport]}.`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to update default template.');
    } finally {
      setBusyId(null);
    }
  };

  const handleActivateVersion = async (
    tpl: DocumentTemplate,
    ver: DocumentTemplateVersion
  ) => {
    if (!isAdmin) return;
    setBusyId(ver.id);
    try {
      const res = await dataService.updateTemplate(tpl.id, { activeVersionId: ver.id });
      setTemplates((prev) => prev.map((t) => (t.id === res.template.id ? res.template : t)));
      setInspectTemplate(res.template);
      onNotify('success', `Activated v${ver.versionNumber} (${ver.fileName}) for "${tpl.name}".`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to switch template version.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDeleteTpl || !isAdmin) return;
    const target = confirmDeleteTpl;
    setConfirmDeleteTpl(null);
    setBusyId(target.id);
    try {
      await dataService.deleteTemplate(target.id);
      setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      onNotify('success', `Deleted official template "${target.name}".`);
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'Failed to delete template.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {/* Section Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <FileCode2 className="h-4 w-4 text-[#163A5F] dark:text-sky-400" aria-hidden="true" />
            <h3 className="text-[18px] font-semibold text-slate-900 dark:text-slate-100">
              Official Government Document Templates (.xlsx / .docx / .pdf)
            </h3>
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-[#163A5F] dark:text-sky-300 border border-slate-200 dark:border-slate-700">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              Administrator Managed
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Upload official LGU / DBM / COA blank templates, inspect mapped placeholders &amp; columns, assign them to reports, and track version history.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-0.5 text-[11px]">
            {(['ALL', 'xlsx', 'docx', 'pdf'] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setFilterFormat(fmt)}
                className={`rounded-md px-2.5 py-1 font-semibold uppercase transition-colors ${
                  filterFormat === fmt
                    ? 'bg-white dark:bg-slate-900 text-[#163A5F] dark:text-sky-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={openNewUploadModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-3.5 py-2 text-xs font-semibold text-white transition-colors shadow-xs"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Upload Official Template</span>
            </button>
          )}
        </div>
      </div>

      {!isAdmin && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-300">
          <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
          <span>
            Read-only view: Only System Administrators can upload, replace, activate, or delete official blank templates.
          </span>
        </div>
      )}

      {/* Templates List */}
      {loading ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 py-4">Loading official templates...</p>
      ) : filteredTemplates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/30 p-6 text-center space-y-2">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            No official blank templates uploaded{filterFormat !== 'ALL' ? ` for .${filterFormat.toUpperCase()}` : ''} yet.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
            Upload your official LGU Bula `.xlsx`, `.docx`, or `.pdf` forms here. The system analyzes column headers, `{'{{placeholders}}'}`, AcroForm fields, logos, and signatory sections automatically while preserving your original layout.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filteredTemplates.map((tpl) => (
            <div
              key={tpl.id}
              className={`rounded-xl border p-4 transition-colors ${
                tpl.isActive
                  ? 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40'
                  : 'border-slate-200/70 dark:border-slate-800/60 bg-slate-100/60 dark:bg-slate-900/60 opacity-75'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <FormatBadge format={tpl.format} />
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {tpl.name}
                    </h4>
                    <span className="rounded bg-slate-200/80 dark:bg-slate-700 px-1.5 py-0.5 text-[10.5px] font-mono font-semibold text-slate-700 dark:text-slate-200">
                      v{tpl.currentVersionNumber}
                    </span>
                    {tpl.isDefault && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800 dark:text-amber-300">
                        <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                        Default
                      </span>
                    )}
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10.5px] font-semibold ${
                        tpl.isActive
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {tpl.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Assigned to:{' '}
                    <strong className="text-slate-800 dark:text-slate-200">
                      {TEMPLATE_TARGET_LABELS[tpl.targetReport]}
                    </strong>
                    {' · '}File: <span className="font-mono">{tpl.fileName}</span> (
                    {(tpl.fileSize / 1024).toFixed(1)} KB)
                  </p>
                  {tpl.description && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">{tpl.description}</p>
                  )}
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Uploaded by <strong>{tpl.createdByName}</strong> · Updated{' '}
                    {new Date(tpl.updatedAt).toLocaleString('en-PH')} ·{' '}
                    {tpl.versions.length} version(s) ·{' '}
                    {tpl.analysis.detectedColumns.length} col(s) /{' '}
                    {tpl.analysis.detectedPlaceholders.length} placeholder(s)
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setInspectTemplate(tpl)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                    title="Preview template structure & version history"
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Inspect / History</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      dataService.downloadTemplateFile(tpl.id, tpl.fileName).catch((err) => {
                        onNotify(
                          'error',
                          err instanceof Error ? err.message : 'Download failed.'
                        );
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-[#163A5F] dark:text-sky-400 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Download</span>
                  </button>

                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => openNewVersionModal(tpl)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>New Version</span>
                      </button>

                      {!tpl.isDefault && (
                        <button
                          type="button"
                          disabled={busyId === tpl.id}
                          onClick={() => handleSetDefault(tpl)}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-100 disabled:opacity-50"
                        >
                          <Star className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Set Default</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setEditingTemplate(tpl);
                          setEditForm({
                            name: tpl.name,
                            description: tpl.description,
                            targetReport: tpl.targetReport,
                            isDefault: tpl.isDefault,
                            isActive: tpl.isActive,
                          });
                        }}
                        className="rounded-lg p-1.5 text-[#2563EB] dark:text-sky-400 hover:bg-blue-50 dark:hover:bg-slate-800"
                        title="Edit assignment & metadata"
                        aria-label={`Edit template ${tpl.name}`}
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>

                      <button
                        type="button"
                        disabled={busyId === tpl.id}
                        onClick={() => setConfirmDeleteTpl(tpl)}
                        className="rounded-lg p-1.5 text-[#DC2626] dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60"
                        title="Delete template"
                        aria-label={`Delete template ${tpl.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload / New Version Modal */}
      {isAdmin && uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-[2px] p-4 overflow-y-auto">
          <div
            ref={uploadModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tpl-upload-modal-title"
            className="my-6 w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4 animate-fade-in"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3
                  id="tpl-upload-modal-title"
                  className="text-lg font-semibold text-slate-900 dark:text-slate-100"
                >
                  {versionTargetTemplate
                    ? `Upload New Version — ${versionTargetTemplate.name} (v${versionTargetTemplate.currentVersionNumber + 1})`
                    : 'Upload Official Blank Template'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Select a blank .xlsx, .docx, or .pdf template. The system previews detected fields and layout before saving.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close template upload modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={
                    versionTargetTemplate
                      ? `.${versionTargetTemplate.format}`
                      : '.xlsx,.docx,.pdf'
                  }
                  onChange={handleFileSelected}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-5 text-center hover:border-[#2563EB] dark:hover:border-sky-500 transition-colors"
                >
                  <Upload className="h-6 w-6 text-[#163A5F] dark:text-sky-400" aria-hidden="true" />
                  <span className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {analyzingFile
                      ? 'Analyzing template structure...'
                      : pickedFile
                        ? `${pickedFile.fileName} (${(pickedFile.fileSize / 1024).toFixed(1)} KB)`
                        : 'Click to choose official blank template (.xlsx, .docx, .pdf)'}
                  </span>
                  <span className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Max 10 MB · Original logos, borders, signatures, and tables are preserved
                  </span>
                </button>
              </div>

              {/* Pre-Activation Template Analysis Preview */}
              {pickedFile && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 p-4 space-y-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Template Structure Analyzed (Preview Before Activating)
                    </span>
                    <FormatBadge format={pickedFile.format} />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11.5px]">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Paper / Orient:</span>{' '}
                      <strong className="uppercase">
                        {pickedFile.analysis.paperSize || 'a4'} ·{' '}
                        {pickedFile.analysis.orientation || 'landscape'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Pages/Sheets:</span>{' '}
                      <strong>{pickedFile.analysis.pageCountOrSheets}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Signatory Block:</span>{' '}
                      <strong>
                        {pickedFile.analysis.detectedSignatureSection ? 'Detected' : 'Not Detected'}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400">Logo / Media:</span>{' '}
                      <strong>
                        {pickedFile.analysis.detectedLogoOrImages ? 'Present' : 'None'}
                      </strong>
                    </div>
                  </div>

                  {pickedFile.analysis.detectedColumns.length > 0 && (
                    <div>
                      <p className="font-semibold text-slate-700 dark:text-slate-300">
                        Detected Table Columns (Row {pickedFile.analysis.detectedHeaderRow || 1}):
                      </p>
                      <p className="mt-0.5 text-[11px] font-mono text-slate-600 dark:text-slate-400 break-words">
                        {pickedFile.analysis.detectedColumns.join(' | ')}
                      </p>
                    </div>
                  )}

                  {pickedFile.analysis.detectedPlaceholders.length > 0 && (
                    <div>
                      <p className="font-semibold text-slate-700 dark:text-slate-300">
                        Detected Dynamic Placeholders / Form Fields:
                      </p>
                      <p className="mt-0.5 text-[11px] font-mono text-slate-600 dark:text-slate-400 break-words">
                        {pickedFile.analysis.detectedPlaceholders.join(', ')}
                      </p>
                    </div>
                  )}

                  {pickedFile.analysis.warnings.map((w, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Template Name <span className="text-[#DC2626]">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    placeholder="e.g. COA/DBM FY 2026 Annual PPA Official Form"
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Assigned Report / Module
                  </label>
                  <select
                    value={tplTargetReport}
                    onChange={(e) => setTplTargetReport(e.target.value as TemplateReportTarget)}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  >
                    {Object.entries(TEMPLATE_TARGET_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Description / Form Reference Number
                  </label>
                  <input
                    type="text"
                    value={tplDescription}
                    onChange={(e) => setTplDescription(e.target.value)}
                    placeholder="e.g. LGU Bula Form MPDO-01 Rev. 2026"
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Version Notes
                  </label>
                  <input
                    type="text"
                    value={tplNotes}
                    onChange={(e) => setTplNotes(e.target.value)}
                    placeholder="Change summary or approval reference"
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-5 text-xs text-slate-700 dark:text-slate-300">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tplIsActive}
                    onChange={(e) => setTplIsActive(e.target.checked)}
                    className="rounded border-slate-300 text-[#2563EB]"
                  />
                  <span>Activate template immediately</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tplIsDefault}
                    onChange={(e) => setTplIsDefault(e.target.checked)}
                    className="rounded border-slate-300 text-[#2563EB]"
                  />
                  <span>Set as Default template for this report &amp; format</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(false)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!pickedFile || uploading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] dark:bg-[#2563EB] dark:hover:bg-[#1D4ED8] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {uploading
                      ? 'Saving Template...'
                      : versionTargetTemplate
                        ? 'Save New Version'
                        : 'Save & Activate Template'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Metadata Modal */}
      {isAdmin && editingTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-[2px] p-4">
          <div
            ref={editModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tpl-edit-title"
            className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4 animate-fade-in"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 id="tpl-edit-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Edit Template Assignment &amp; Settings
              </h3>
              <button
                type="button"
                onClick={() => setEditingTemplate(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300">Name</label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300">Description</label>
                <input
                  type="text"
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300">Assigned Report</label>
                <select
                  value={editForm.targetReport}
                  onChange={(e) =>
                    setEditForm({ ...editForm, targetReport: e.target.value as TemplateReportTarget })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-slate-900 dark:text-slate-100"
                >
                  {Object.entries(TEMPLATE_TARGET_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-4 pt-1">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.isActive}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        isActive: e.target.checked,
                        isDefault: e.target.checked ? editForm.isDefault : false,
                      })
                    }
                  />
                  <span>Active</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!editForm.isActive}
                    checked={editForm.isDefault}
                    onChange={(e) => setEditForm({ ...editForm, isDefault: e.target.checked })}
                  />
                  <span>Default for this report</span>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingTemplate(null)}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-3.5 py-2 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded-lg bg-[#163A5F] hover:bg-[#1E4D7B] px-3.5 py-2 font-semibold text-white disabled:opacity-50"
                >
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inspect Structure & Version History Modal */}
      {inspectTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-[2px] p-4 overflow-y-auto">
          <div
            ref={inspectModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tpl-inspect-title"
            className="my-6 w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-5 animate-fade-in"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <FormatBadge format={inspectTemplate.format} />
                  <h3
                    id="tpl-inspect-title"
                    className="text-lg font-semibold text-slate-900 dark:text-slate-100"
                  >
                    {inspectTemplate.name}
                  </h3>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {TEMPLATE_TARGET_LABELS[inspectTemplate.targetReport]} · Active: v
                  {inspectTemplate.currentVersionNumber} · SHA-256:{' '}
                  <span className="font-mono">{inspectTemplate.sha256.slice(0, 14)}...</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectTemplate(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Structure Summary */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-2 text-xs">
              <p className="font-semibold text-slate-900 dark:text-slate-100">
                Analyzed Structure &amp; Mapping Summary
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Paper / Orient:</span>{' '}
                  <strong className="uppercase">
                    {inspectTemplate.analysis.paperSize || 'a4'} ·{' '}
                    {inspectTemplate.analysis.orientation || 'landscape'}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Pages/Sheets:</span>{' '}
                  <strong>{inspectTemplate.analysis.pageCountOrSheets}</strong>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Signatory Block:</span>{' '}
                  <strong>
                    {inspectTemplate.analysis.detectedSignatureSection ? 'Yes' : 'No'}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Logo / Media:</span>{' '}
                  <strong>{inspectTemplate.analysis.detectedLogoOrImages ? 'Yes' : 'No'}</strong>
                </div>
              </div>
              {inspectTemplate.analysis.detectedColumns.length > 0 && (
                <p className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                  Columns: {inspectTemplate.analysis.detectedColumns.join(' | ')}
                </p>
              )}
              {inspectTemplate.analysis.detectedPlaceholders.length > 0 && (
                <p className="text-[11px] font-mono text-slate-600 dark:text-slate-300">
                  Placeholders: {inspectTemplate.analysis.detectedPlaceholders.join(', ')}
                </p>
              )}
            </div>

            {inspectTemplate.format === 'pdf' && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                {loadingInspectPdf ? (
                  <p className="p-6 text-center text-xs text-slate-500">Loading PDF template preview...</p>
                ) : inspectPdfUrl ? (
                  <iframe
                    title={`Blank Template Preview — ${inspectTemplate.name}`}
                    src={inspectPdfUrl}
                    className="w-full h-80 border-0 bg-slate-100 dark:bg-slate-800"
                  />
                ) : null}
              </div>
            )}

            {/* Version History */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                <History className="h-4 w-4 text-[#163A5F] dark:text-sky-400" aria-hidden="true" />
                <span>Version History ({inspectTemplate.versions.length})</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
                {inspectTemplate.versions.map((ver) => {
                  const isCurrent = ver.id === inspectTemplate.currentVersionId;
                  return (
                    <div
                      key={ver.id}
                      className="p-3 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-[#163A5F] dark:text-sky-400">
                            v{ver.versionNumber}
                          </span>
                          <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {ver.fileName}
                          </span>
                          {isCurrent && (
                            <span className="rounded bg-emerald-50 dark:bg-emerald-950/50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                              Active Version
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {new Date(ver.uploadedAt).toLocaleString('en-PH')} by{' '}
                          <strong>{ver.uploadedByName}</strong> · {(ver.fileSize / 1024).toFixed(1)} KB
                          {ver.notes ? ` · "${ver.notes}"` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            dataService
                              .downloadTemplateFile(inspectTemplate.id, ver.fileName, ver.id)
                              .catch((err) =>
                                onNotify('error', err instanceof Error ? err.message : 'Download failed.')
                              )
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          <Download className="h-3 w-3" />
                          <span>Download</span>
                        </button>
                        {isAdmin && !isCurrent && (
                          <button
                            type="button"
                            disabled={busyId === ver.id}
                            onClick={() => handleActivateVersion(inspectTemplate, ver)}
                            className="rounded-md bg-[#163A5F] hover:bg-[#1E4D7B] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                          >
                            Activate v{ver.versionNumber}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDeleteTpl)}
        title="Delete Official Document Template"
        message={`Permanently delete "${confirmDeleteTpl?.name || ''}" and all ${confirmDeleteTpl?.versions.length || 1} stored version(s)? Standard system report generation will continue to work.`}
        confirmLabel="Delete Template"
        destructive
        onCancel={() => setConfirmDeleteTpl(null)}
        onConfirm={handleDeleteConfirm}
      />
    </section>
  );
}
