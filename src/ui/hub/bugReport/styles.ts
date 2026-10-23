// src/ui/hub/bugReport/styles.ts
// Rules for the Report a bug modal, in the hub's palette (teal accent on dark
// glass). Every class starts with `qws-ch-bug-`.

const STYLE_ID = "qws-ch-bug-css";

const BUG_REPORT_CSS = `
.qws-ch-bug-overlay{
  position:absolute; top:0; right:0; bottom:0; left:0; z-index:20;
  display:flex; align-items:center; justify-content:center; padding:12px;
  background:rgba(8,12,18,0.86); backdrop-filter:blur(4px); border-radius:18px;
}
.qws-ch-bug-card{
  position:relative; width:min(640px, 100%); height:100%; max-height:620px;
  display:flex; flex-direction:column; overflow:hidden;
  background:linear-gradient(160deg, rgba(22,28,42,0.99) 0%, rgba(12,18,28,0.99) 100%);
  border:1px solid rgba(94,234,212,0.22); border-radius:14px; color:#e7eef7;
  box-shadow:0 8px 36px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04) inset;
}
.qws-ch-bug-card:focus{ outline:none; }
.qws-ch-bug-head{ display:flex; align-items:center; gap:12px; padding:16px 18px 12px; }
.qws-ch-bug-head-icon{
  width:36px; height:36px; flex-shrink:0; display:grid; place-items:center; border-radius:10px;
  background:rgba(251,191,36,0.12); border:1px solid rgba(251,191,36,0.25); color:#fbbf24;
}
.qws-ch-bug-head-icon svg{ width:18px; height:18px; display:block; }
.qws-ch-bug-head-text{ flex:1; min-width:0; }
.qws-ch-bug-title{ font-weight:700; font-size:15px; color:#e7eef7; }
.qws-ch-bug-subtitle{ font-size:11px; color:rgba(231,238,247,0.45); margin-top:2px; }
.qws-ch-bug-x{
  width:28px; height:28px; flex-shrink:0; display:grid; place-items:center; padding:0;
  border:1px solid rgba(255,255,255,0.10); border-radius:8px; background:rgba(255,255,255,0.04);
  color:rgba(231,238,247,0.55); cursor:pointer;
  transition:background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.qws-ch-bug-x:hover{ background:rgba(239,68,68,0.14); border-color:rgba(239,68,68,0.3); color:#ef4444; }
.qws-ch-bug-x svg{ width:14px; height:14px; display:block; }
.qws-ch-bug-tabs{ display:flex; gap:8px; padding:0 18px 12px; border-bottom:1px solid rgba(255,255,255,0.08); }
.qws-ch-bug-tab{
  flex:1; padding:8px 16px; border:1px solid rgba(255,255,255,0.08); border-radius:8px;
  background:transparent; color:#c9d4e6; font-size:12px; font-weight:600; cursor:pointer;
  transition:all 120ms ease;
}
.qws-ch-bug-tab:hover{ background:rgba(94,234,212,0.08); color:#e7eef7; }
.qws-ch-bug-tab.active{ background:rgba(94,234,212,0.18); color:#ecfdf5; }
.qws-ch-bug-body{ flex:1; min-height:0; overflow-y:auto; padding:14px 18px 18px; }
.qws-ch-bug-view{ display:flex; flex-direction:column; gap:14px; }
.qws-ch-bug-view[hidden]{ display:none; }

.qws-ch-bug-section{
  display:flex; flex-direction:column; gap:12px; padding:14px 16px;
  background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.08); border-radius:12px;
  transition:border-color 120ms ease, background 120ms ease;
}
.qws-ch-bug-section.dragging{ border-color:rgba(94,234,212,0.45); background:rgba(94,234,212,0.05); }
.qws-ch-bug-section-title{ font-size:14px; font-weight:700; color:#e7eef7; }
.qws-ch-bug-section-sub{ margin-top:-8px; font-size:12px; line-height:1.4; color:rgba(226,232,240,0.6); }
.qws-ch-bug-note{ margin:0; font-size:12px; line-height:1.5; color:rgba(226,232,240,0.7); }
.qws-ch-bug-hint{ display:block; margin:0; font-size:11px; line-height:1.45; color:rgba(226,232,240,0.5); }
.qws-ch-bug-hint:empty{ display:none; }

.qws-ch-bug-field{ display:flex; flex-direction:column; gap:6px; min-width:0; }
.qws-ch-bug-label{ font-size:12px; font-weight:600; color:#e7eef7; }
.qws-ch-bug-optional{ font-weight:400; color:rgba(226,232,240,0.45); }
.qws-ch-bug-input{
  width:100%; padding:10px 14px; border:1px solid rgba(255,255,255,0.12); border-radius:10px;
  background:rgba(255,255,255,0.04); color:#e7eef7; font-size:13px; font-family:inherit;
  outline:none; transition:border-color 150ms ease;
}
.qws-ch-bug-input::placeholder{ color:rgba(226,232,240,0.35); }
.qws-ch-bug-input:focus{ border-color:rgba(94,234,212,0.35); }
textarea.qws-ch-bug-input{ min-height:96px; resize:vertical; line-height:1.45; }
textarea.qws-ch-bug-input.short{ min-height:56px; }
select.qws-ch-bug-input{ cursor:pointer; }
select.qws-ch-bug-input option{ background:#111827; color:#e7eef7; }
.qws-ch-bug-field.invalid .qws-ch-bug-input{ border-color:rgba(239,68,68,0.55); }
.qws-ch-bug-field.invalid .qws-ch-bug-hint{ color:#f87171; font-weight:600; }
.qws-ch-bug-row{ display:flex; flex-wrap:wrap; gap:12px; }
.qws-ch-bug-row > .qws-ch-bug-field{ flex:1 1 180px; }

.qws-ch-bug-chips{ display:flex; flex-wrap:wrap; gap:6px; }
.qws-ch-bug-chip{ position:relative; display:inline-flex; }
.qws-ch-bug-chip input{ position:absolute; opacity:0; pointer-events:none; }
.qws-ch-bug-chip span{
  padding:5px 11px; border-radius:999px; border:1px solid rgba(255,255,255,0.10);
  background:rgba(255,255,255,0.03); color:#c9d4e6; font-size:12px; font-weight:600;
  cursor:pointer; transition:all 120ms ease; user-select:none;
}
.qws-ch-bug-chip span:hover{ background:rgba(94,234,212,0.08); color:#e7eef7; }
.qws-ch-bug-chip input:checked + span{ background:rgba(94,234,212,0.18); border-color:rgba(94,234,212,0.35); color:#ecfdf5; }
.qws-ch-bug-chip input:focus-visible + span{ outline:2px solid rgba(94,234,212,0.6); outline-offset:2px; }

.qws-ch-bug-details{ border-top:1px solid rgba(255,255,255,0.06); padding-top:10px; }
.qws-ch-bug-summary{
  display:flex; align-items:center; gap:8px; cursor:pointer; list-style:none;
  font-size:13px; font-weight:600; color:#e7eef7;
}
.qws-ch-bug-summary::-webkit-details-marker{ display:none; }
.qws-ch-bug-summary::before{
  content:""; width:6px; height:6px; margin:0 2px;
  border-right:2px solid currentColor; border-bottom:2px solid currentColor;
  transform:rotate(-45deg); transition:transform 120ms ease;
}
.qws-ch-bug-details[open] > .qws-ch-bug-summary::before{ transform:rotate(45deg); }
.qws-ch-bug-summary-hint{ font-weight:400; font-size:11px; color:rgba(226,232,240,0.5); }
.qws-ch-bug-details-body{ display:flex; flex-direction:column; gap:12px; margin-top:12px; }

.qws-ch-bug-notice{
  display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:10px 12px; border-radius:10px;
  border:1px solid rgba(251,191,36,0.3); background:rgba(251,191,36,0.08); color:#fcd34d;
  font-size:12px; font-weight:600; line-height:1.45;
}
.qws-ch-bug-notice > span{ flex:1 1 200px; }
.qws-ch-bug-notice.info{ border-color:rgba(94,234,212,0.2); background:rgba(94,234,212,0.08); color:rgba(226,232,240,0.85); }
.qws-ch-bug-notice.error{ border-color:rgba(239,68,68,0.3); background:rgba(239,68,68,0.10); color:#fca5a5; }
.qws-ch-bug-notice[hidden]{ display:none; }

.qws-ch-bug-btn{
  padding:6px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.12);
  background:rgba(255,255,255,0.04); color:#e7eef7; font-size:12px; font-weight:600;
  font-family:inherit; cursor:pointer; transition:all 120ms ease;
}
.qws-ch-bug-btn:hover:not(:disabled){ background:rgba(255,255,255,0.08); border-color:rgba(94,234,212,0.25); }
.qws-ch-bug-btn.primary{ background:rgba(94,234,212,0.15); border-color:rgba(94,234,212,0.4); color:#5eead4; }
.qws-ch-bug-btn.primary:hover:not(:disabled){ background:rgba(94,234,212,0.25); border-color:rgba(94,234,212,0.5); }
.qws-ch-bug-btn.big{ padding:10px 18px; font-size:13px; }
.qws-ch-bug-btn:disabled{ opacity:0.5; cursor:not-allowed; }
.qws-ch-bug-btn[hidden]{ display:none; }
.qws-ch-bug-btn:focus-visible, .qws-ch-bug-x:focus-visible, .qws-ch-bug-tab:focus-visible,
.qws-ch-bug-shot-open:focus-visible, .qws-ch-bug-shot-remove:focus-visible{
  outline:2px solid rgba(94,234,212,0.6); outline-offset:2px;
}

.qws-ch-bug-shots{ display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; }
.qws-ch-bug-shots:empty{ display:none; }
.qws-ch-bug-shot{
  position:relative; aspect-ratio:16 / 10; overflow:hidden; border-radius:10px;
  border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.03);
}
.qws-ch-bug-shot.pending{ display:grid; place-items:center; font-size:11px; color:rgba(226,232,240,0.5); cursor:progress; }
.qws-ch-bug-shot-open{ display:block; width:100%; height:100%; padding:0; border:none; background:none; cursor:zoom-in; }
.qws-ch-bug-shot-open img{ display:block; width:100%; height:100%; object-fit:cover; }
.qws-ch-bug-shot-label{
  position:absolute; left:0; right:0; bottom:0; padding:3px 6px; pointer-events:none;
  background:rgba(8,12,18,0.78); color:#e7eef7; font-size:10px; font-weight:600;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.qws-ch-bug-shot-remove{
  position:absolute; top:4px; right:4px; width:22px; height:22px; display:grid; place-items:center;
  padding:0; border-radius:999px; border:1px solid rgba(255,255,255,0.15);
  background:rgba(8,12,18,0.8); color:#e7eef7; cursor:pointer; transition:all 120ms ease;
}
.qws-ch-bug-shot-remove:hover{ background:rgba(239,68,68,0.3); border-color:rgba(239,68,68,0.5); }
.qws-ch-bug-shot-remove svg{ width:12px; height:12px; display:block; }
.qws-ch-bug-shot-bar{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.qws-ch-bug-shot-bar > .qws-ch-bug-hint{ flex:1 1 140px; }
.qws-ch-bug-full{ display:block; max-width:100%; height:auto; margin:0 auto; border-radius:8px; }

.qws-ch-bug-data-row{
  display:flex; align-items:center; gap:12px; padding:10px 12px;
  background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:8px;
}
.qws-ch-bug-data-text{ flex:1; min-width:0; }
.qws-ch-bug-data-title{ font-size:13px; font-weight:600; color:#e7eef7; }
.qws-ch-bug-data-desc{ margin-top:2px; font-size:11px; line-height:1.4; color:rgba(226,232,240,0.6); }
.qws-ch-bug-switch{ position:relative; flex-shrink:0; width:44px; height:24px; }
.qws-ch-bug-switch input{ position:absolute; top:0; left:0; width:100%; height:100%; margin:0; opacity:0; cursor:pointer; }
.qws-ch-bug-switch span{
  position:absolute; top:0; right:0; bottom:0; left:0; border-radius:12px; pointer-events:none;
  background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.15); transition:all 200ms ease;
}
.qws-ch-bug-switch span::after{
  content:""; position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%;
  background:rgba(255,255,255,0.6); transition:all 200ms ease;
}
.qws-ch-bug-switch input:checked + span{ background:rgba(94,234,212,0.3); border-color:rgba(94,234,212,0.5); }
.qws-ch-bug-switch input:checked + span::after{ left:22px; background:#5eead4; }
.qws-ch-bug-switch input:disabled{ cursor:default; }
.qws-ch-bug-switch input:disabled + span{ opacity:0.6; }
.qws-ch-bug-switch input:focus-visible + span{ outline:2px solid rgba(94,234,212,0.6); outline-offset:2px; }

.qws-ch-bug-actions{ display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:10px; }
.qws-ch-bug-progress{ flex:1 1 160px; font-size:12px; color:rgba(226,232,240,0.7); }
.qws-ch-bug-progress:empty{ display:none; }

.qws-ch-bug-success{ display:flex; flex-direction:column; align-items:center; gap:12px; padding:28px 12px; text-align:center; }
.qws-ch-bug-success-icon{
  width:48px; height:48px; display:grid; place-items:center; border-radius:50%;
  background:rgba(94,234,212,0.12); border:1px solid rgba(94,234,212,0.3); color:#5eead4;
}
.qws-ch-bug-success-icon svg{ width:22px; height:22px; display:block; }
.qws-ch-bug-success-title{ font-size:16px; font-weight:700; color:#e7eef7; }
.qws-ch-bug-ref{
  display:flex; align-items:center; gap:10px; padding:6px 8px 6px 14px; border-radius:999px;
  background:rgba(94,234,212,0.10); border:1px solid rgba(94,234,212,0.25);
}
.qws-ch-bug-ref-code{ font-family:monospace; font-size:16px; font-weight:700; color:#5eead4; user-select:all; }

.qws-ch-bug-dialog{ position:absolute; top:0; right:0; bottom:0; left:0; z-index:2; display:flex; flex-direction:column; background:rgba(12,18,28,0.98); }
.qws-ch-bug-dialog-head{ padding:16px 18px 12px; border-bottom:1px solid rgba(255,255,255,0.08); }
.qws-ch-bug-dialog-title{ font-weight:700; font-size:14px; color:#e7eef7; }
.qws-ch-bug-dialog-body{ flex:1; min-height:0; overflow:auto; padding:14px 18px; display:flex; flex-direction:column; gap:10px; }
.qws-ch-bug-dialog-foot{ display:flex; justify-content:flex-end; gap:8px; padding:12px 18px; border-top:1px solid rgba(255,255,255,0.08); }
.qws-ch-bug-json{
  margin:0; padding:10px 12px; border-radius:8px; background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.06);
  color:rgba(226,232,240,0.85); font-family:monospace; font-size:11px; line-height:1.5;
  white-space:pre-wrap; word-break:break-word; user-select:text;
}

.qws-ch-bug-list-head{ display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
.qws-ch-bug-list-head > .qws-ch-bug-note{ flex:1 1 200px; }
.qws-ch-bug-list{ display:flex; flex-direction:column; gap:10px; }
.qws-ch-bug-empty{
  padding:28px 18px; border-radius:12px; border:1px dashed rgba(255,255,255,0.10); background:rgba(255,255,255,0.02);
  text-align:center; font-size:12px; line-height:1.5; color:rgba(226,232,240,0.6);
}
.qws-ch-bug-empty-title{ margin-bottom:6px; font-size:14px; font-weight:700; color:#e7eef7; }
.qws-ch-bug-report-head{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.qws-ch-bug-report-title{ flex:1 1 180px; min-width:0; font-size:13px; font-weight:700; color:#e7eef7; overflow-wrap:anywhere; }
.qws-ch-bug-meta{ font-size:11px; color:rgba(226,232,240,0.5); }
.qws-ch-bug-pill{
  display:inline-flex; align-items:center; padding:2px 8px; border-radius:6px; white-space:nowrap;
  border:1px solid rgba(226,232,240,0.15); background:rgba(226,232,240,0.05);
  color:rgba(226,232,240,0.7); font-size:10px; font-weight:600;
}
.qws-ch-bug-pill.ref{ font-family:monospace; }
.qws-ch-bug-pill.ok{ border-color:rgba(94,234,212,0.3); background:rgba(94,234,212,0.1); color:#5eead4; }
.qws-ch-bug-pill.warn{ border-color:rgba(251,191,36,0.3); background:rgba(251,191,36,0.1); color:#fbbf24; }
.qws-ch-bug-fix{
  padding:8px 10px; border-radius:8px; font-size:12px; font-weight:600;
  border:1px solid rgba(94,234,212,0.2); background:rgba(94,234,212,0.08); color:#5eead4;
}
.qws-ch-bug-fix.update{
  display:flex; flex-wrap:wrap; align-items:center; gap:10px;
  border-color:rgba(251,191,36,0.3); background:rgba(251,191,36,0.08); color:#fcd34d;
}
.qws-ch-bug-fix.update > span{ flex:1 1 160px; }
.qws-ch-bug-thread{ display:flex; flex-direction:column; gap:6px; }
.qws-ch-bug-comment{
  max-width:88%; padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.06);
  background:rgba(255,255,255,0.04); color:#e7eef7; font-size:12px; line-height:1.45;
  white-space:pre-wrap; overflow-wrap:anywhere;
}
.qws-ch-bug-comment.admin{ align-self:flex-start; background:rgba(94,234,212,0.08); border-color:rgba(94,234,212,0.25); }
.qws-ch-bug-comment.reporter{ align-self:flex-end; }
.qws-ch-bug-comment-who{ display:block; margin-bottom:2px; font-size:10px; font-weight:700; color:rgba(226,232,240,0.5); }
.qws-ch-bug-comment.admin .qws-ch-bug-comment-who{ color:#5eead4; }
.qws-ch-bug-reply{ display:flex; flex-direction:column; gap:8px; }
`;

export function ensureBugReportStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = BUG_REPORT_CSS;
  (document.head ?? document.documentElement).appendChild(st);
}
