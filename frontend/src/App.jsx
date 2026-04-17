import { useState, useEffect, useCallback, useRef } from 'react';
import { handleCallback, logout } from './auth';
import { listOcgs, getOcg, analyzeTimecard, chatOcg } from './api/client';

// Mock data for local dev — remove when API is wired
const MOCK_OCGS = [
  { id: 'ocg-001', name: 'Acme Corp — Outside Counsel Guidelines 2026' },
  { id: 'ocg-002', name: 'Globex Inc — Billing & Staffing Guidelines v3' },
  { id: 'ocg-003', name: 'Initech — Approved Task & Rate Schedule' },
];

const MOCK_OCG_CONTENT = {
  'ocg-001': {
    name: 'Acme Corp — Outside Counsel Guidelines 2026',
    sections: [
      { id: 'section-1', title: 'Section 1 — General Provisions', text: 'These Outside Counsel Guidelines ("Guidelines") govern the relationship between Acme Corp ("Company") and any outside law firm ("Firm") retained to provide legal services. All billing must comply with these Guidelines. Failure to comply may result in reduction or rejection of invoices.' },
      { id: 'section-2', title: 'Section 2 — Staffing Requirements', text: 'The Firm shall staff matters efficiently and avoid overstaffing. No more than two attorneys may attend any deposition, hearing, or meeting without prior written approval. Junior associates may not bill for attendance at internal strategy meetings.' },
      { id: 'section-3', title: 'Section 3 — Rate Schedules', text: 'All timekeepers must be approved in advance. Rate increases require 60 days written notice and Company approval. Blended rates are not accepted. Each timekeeper must bill at their individual approved rate.' },
      { id: 'section-4-1', title: 'Section 4.1 — General Billing Standards', text: 'All time entries must be recorded in increments of no less than 0.1 hours. Block billing (combining multiple tasks into a single entry) is prohibited. Each entry must describe a single task with sufficient detail to evaluate the work performed.' },
      { id: 'section-4-2-a', title: 'Section 4.2(a) — Permitted Billable Activities', text: 'The following activities are billable: legal research directly related to the matter; drafting and revising pleadings, motions, and briefs; court appearances and depositions; client communications regarding substantive legal issues; document review for relevance and privilege; negotiation of settlement terms.' },
      { id: 'section-4-2-b', title: 'Section 4.2(b) — Billable Travel Time', text: 'Travel time is billable at 50% of the standard rate only when travel exceeds 2 hours one-way. Local travel within the metropolitan area is not billable. Air travel must be economy class unless pre-approved.' },
      { id: 'section-5', title: 'Section 5 — Expense Guidelines', text: 'Photocopying charges shall not exceed $0.15 per page. Overnight delivery charges require justification. Meals during travel are reimbursable up to $75 per day. First-class travel is never reimbursable.' },
      { id: 'section-6-1-a', title: 'Section 6.1(a) — Non-Billable Internal Activities', text: 'The following are not billable: internal firm meetings not directly related to the matter; time spent preparing or reviewing invoices; conflicts checks; file organization and administrative tasks; training of junior associates on general legal skills.' },
      { id: 'section-6-1-b', title: 'Section 6.1(b) — Non-Billable Communications', text: 'Routine status update emails and scheduling communications are not billable. Only substantive legal communications with the client or opposing counsel may be billed.' },
      { id: 'section-6-1-c', title: 'Section 6.1(c) — Non-Billable Administrative Tasks', text: 'Administrative and clerical tasks are not billable regardless of who performs them. This includes: scheduling meetings, organizing files, preparing cover letters for filings, updating case management systems, and coordinating with court clerks on procedural matters.' },
      { id: 'section-7', title: 'Section 7 — Invoice Requirements', text: 'Invoices must be submitted monthly within 30 days of the billing period. Late invoices may be subject to a 10% reduction. All invoices must be in LEDES format and include matter number, timekeeper ID, task code, and activity code.' },
      { id: 'section-8', title: 'Section 8 — Audit Rights', text: 'The Company reserves the right to audit all invoices and supporting documentation. The Firm shall retain all time records and expense receipts for a minimum of 5 years. The Company may engage a third-party auditor at its discretion.' },
    ],
  },
};

function createEntry() {
  return { id: crypto.randomUUID(), description: '', hours: '', feedback: null };
}

export default function App() {
  const [ocgs, setOcgs] = useState([]);
  const [selectedOcg, setSelectedOcg] = useState('');
  const [entries, setEntries] = useState([createEntry()]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerOcg, setViewerOcg] = useState(null);
  const [viewerAnchor, setViewerAnchor] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    handleCallback();
    listOcgs()
      .then((data) => setOcgs(data.ocgs || data))
      .catch(() => setOcgs(MOCK_OCGS));
  }, []);

  const openOcgViewer = useCallback(async (citationId) => {
    if (!selectedOcg) return;
    // Try API first, fall back to mock
    let ocgData = viewerOcg;
    if (!ocgData || ocgData.id !== selectedOcg) {
      try {
        ocgData = await getOcg(selectedOcg);
      } catch {
        ocgData = MOCK_OCG_CONTENT[selectedOcg] || null;
      }
      if (ocgData) setViewerOcg({ ...ocgData, id: selectedOcg });
    }
    setViewerAnchor(citationId || null);
    setViewerOpen(true);
  }, [selectedOcg, viewerOcg]);

  const updateEntry = useCallback((id, field, value) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  }, []);

  const addEntry = useCallback(() => {
    setEntries((prev) => [...prev, createEntry()]);
  }, []);

  const removeEntry = useCallback((id) => {
    setEntries((prev) => (prev.length > 1 ? prev.filter((e) => e.id !== id) : prev));
  }, []);

  const handleAnalyze = async () => {
    if (!selectedOcg) { setError('Please select an OCG before analyzing.'); return; }
    const valid = entries.filter((e) => e.description.trim() && e.hours);
    if (valid.length === 0) { setError('Enter at least one timecard entry.'); return; }

    setError(null);
    setAnalyzing(true);
    // Clear previous feedback
    setEntries((prev) => prev.map((e) => ({ ...e, feedback: null })));

    try {
      const payload = valid.map((e) => ({
        id: e.id,
        description: e.description.trim(),
        hours: parseFloat(e.hours),
      }));
      const result = await analyzeTimecard(selectedOcg, payload);
      const feedbackMap = {};
      (result.results || result).forEach((r) => { feedbackMap[r.id] = r; });
      setEntries((prev) => prev.map((e) => ({ ...e, feedback: feedbackMap[e.id] || null })));
    } catch (err) {
      console.error('Analyze API error:', err);
      setError(`Analysis failed: ${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleChatSend = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    if (!selectedOcg) return;

    const userMsg = { role: 'user', content: text };
    const updated = [...chatMessages, userMsg];
    setChatMessages(updated);
    setChatInput('');
    setChatLoading(true);

    try {
      const result = await chatOcg(selectedOcg, updated);
      setChatMessages((prev) => [...prev, { role: 'assistant', content: result.reply }]);
    } catch (err) {
      console.error('Chat API error:', err);
      setChatMessages((prev) => [...prev, { role: 'assistant', content: `⚠ Error: ${err.message}\n\nPlease try again. If the issue persists, check the browser console for details.` }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="sticky top-0 z-50 h-14 flex items-center bg-white border-b-2 border-red shadow-sm px-8">
        <div className="flex items-center gap-4 flex-1">
          <span className="font-serif text-red text-xl font-bold tracking-tight" style={{ letterSpacing: '-1.5px' }}>
            Cooley
          </span>
          <div className="w-px h-5 bg-border" />
          <div>
            <div className="text-[0.8rem] font-semibold text-txt">OCG Timecard Analyzer</div>
            <div className="text-[0.67rem] text-txt-muted">Technology Infrastructure · Enterprise Architecture</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[0.6rem] font-medium text-red bg-red-light border border-red-mid px-2 py-0.5 rounded-[3px] tracking-wide">
            AI-Assisted
          </span>
          <button
            onClick={logout}
            className="text-[0.74rem] font-semibold text-red bg-transparent border-[1.5px] border-red rounded-cooley px-3 py-1 cursor-pointer transition-colors duration-150 hover:bg-red hover:text-white"
          >
            Sign Out
          </button>
        </div>
      </nav>

      {/* Page header */}
      <div className="bg-white border-b border-border py-6">
        <div className="max-w-[980px] mx-auto px-8">
          <div className="font-mono text-[0.63rem] font-semibold uppercase tracking-widest text-red mb-1">
            // Billing Compliance
          </div>
          <h1 className="font-serif text-2xl text-txt mb-1">Timecard Entry Analyzer</h1>
          <p className="text-[0.845rem] text-txt-dim max-w-xl">
            Select an Outside Counsel Guideline and enter timecard line-items. The AI will analyze each entry against the OCG and flag potential billing issues with citations.
          </p>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-[980px] mx-auto px-8 py-8">
        {/* OCG selector card */}
        <div className="bg-white border border-border border-t-[3px] border-t-red rounded-cooley shadow-sm mb-6">
          <div className="flex items-center gap-3 px-6 py-3 bg-surface border-b border-border">
            <span className="text-[0.9rem]">📋</span>
            <div className="flex-1">
              <div className="text-[0.88rem] font-semibold text-txt">Outside Counsel Guideline</div>
              <div className="text-[0.68rem] text-txt-muted font-mono">Select the OCG to analyze against</div>
            </div>
            <span className="font-mono text-[0.58rem] font-semibold bg-red text-white px-2 py-0.5 rounded-[3px] tracking-wide">
              REQUIRED
            </span>
          </div>
          <div className="px-6 py-5">
            <label className="block text-[0.68rem] font-semibold uppercase tracking-wide text-txt-muted mb-1.5">
              Available OCGs <span className="text-red">*</span>
            </label>
            <select
              value={selectedOcg}
              onChange={(e) => { setSelectedOcg(e.target.value); setError(null); setEntries([createEntry()]); setChatMessages([]); setChatInput(''); setChatOpen(false); setViewerOcg(null); }}
              className="w-full bg-surface border-[1.5px] border-border rounded-cooley px-3 py-2.5 text-[0.82rem] text-txt font-sans appearance-none transition-colors duration-200 focus:outline-none focus:border-red focus:bg-white"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%239A9A9A' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 0.75rem center',
                paddingRight: '2.25rem',
              }}
            >
              <option value="">Select an OCG…</option>
              {ocgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Timecard entries card */}
        <div className="bg-white border border-border rounded-cooley shadow-sm mb-6">
          <div className="flex items-center gap-3 px-6 py-3 bg-surface border-b border-border">
            <span className="text-[0.9rem]">⏱️</span>
            <div className="flex-1">
              <div className="text-[0.88rem] font-semibold text-txt">Timecard Entries</div>
              <div className="text-[0.68rem] text-txt-muted font-mono">
                {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
              </div>
            </div>
          </div>
          <div className="px-6 py-5 flex flex-col gap-5">
            {entries.map((entry, idx) => (
              <TimecardEntry
                key={entry.id}
                entry={entry}
                index={idx}
                canRemove={entries.length > 1}
                onChange={updateEntry}
                onRemove={removeEntry}
                onCitationClick={openOcgViewer}
              />
            ))}

            <button
              onClick={addEntry}
              className="self-start flex items-center gap-2 text-[0.78rem] font-semibold text-red bg-transparent border-[1.5px] border-red rounded-cooley px-4 py-2 transition-colors duration-150 hover:bg-red hover:text-white"
            >
              + Add Line Item
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-emerg-bg border border-emerg-bd rounded-cooley px-4 py-3 mb-4 text-[0.82rem] text-emerg-text flex items-center gap-2">
            <span>⚠️</span> {error}
          </div>
        )}

        {/* Analyze button */}
        <div className="bg-white border border-border border-t-[3px] border-t-red rounded-cooley shadow-md p-6 flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="text-[0.88rem] font-semibold text-txt">Ready to analyze?</div>
            <div className="text-[0.78rem] text-txt-dim">
              The AI will review each entry against the selected OCG and provide billability feedback with citations.
            </div>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="bg-red text-white border-none rounded-cooley px-6 py-2.5 text-[0.82rem] font-semibold cursor-pointer transition-colors duration-150 hover:bg-red-hover disabled:bg-txt-muted disabled:cursor-not-allowed tracking-wide"
          >
            {analyzing ? 'Analyzing…' : 'Analyze Entries →'}
          </button>
        </div>

        {/* OCG Chat Panel */}
        <div className="mt-6">
          <button
            onClick={() => { if (selectedOcg) setChatOpen(!chatOpen); }}
            disabled={!selectedOcg}
            className={`w-full flex items-center gap-3 px-6 py-3 bg-white border border-border rounded-cooley shadow-sm transition-colors duration-150 cursor-pointer ${!selectedOcg ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface'} ${chatOpen ? 'rounded-b-none border-b-0' : ''}`}
          >
            <span className="text-[0.9rem]">💬</span>
            <div className="flex-1 text-left">
              <div className="text-[0.88rem] font-semibold text-txt">Ask About This OCG</div>
              <div className="text-[0.68rem] text-txt-muted font-mono">
                {selectedOcg ? 'Chat with the AI about billing rules, permitted activities, and restrictions' : 'Select an OCG first'}
              </div>
            </div>
            <span className={`text-txt-muted text-[0.7rem] transition-transform duration-200 ${chatOpen ? 'rotate-180' : ''}`}>▾</span>
          </button>
          {chatOpen && selectedOcg && (
            <OcgChatPanel
              messages={chatMessages}
              input={chatInput}
              loading={chatLoading}
              onInputChange={setChatInput}
              onSend={handleChatSend}
              onCitationClick={openOcgViewer}
            />
          )}
        </div>
      </div>

      {/* OCG Viewer Modal */}
      {viewerOpen && viewerOcg && (
        <OcgViewerModal
          ocg={viewerOcg}
          anchor={viewerAnchor}
          onClose={() => { setViewerOpen(false); setViewerAnchor(null); }}
        />
      )}
    </div>
  );
}

function TimecardEntry({ entry, index, canRemove, onChange, onRemove, onCitationClick }) {
  const fb = entry.feedback;

  return (
    <div>
      {/* Entry row */}
      <div className="border border-border rounded-cooley overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 bg-surface border-b border-border">
          <span className="font-mono text-[0.62rem] text-txt-muted">#{index + 1}</span>
          <span className="text-[0.78rem] font-semibold text-txt-dim flex-1">Line Item</span>
          {canRemove && (
            <button
              onClick={() => onRemove(entry.id)}
              className="text-[0.68rem] text-txt-muted hover:text-red transition-colors duration-150 cursor-pointer bg-transparent border-none"
              aria-label="Remove entry"
            >
              ✕
            </button>
          )}
        </div>
        <div className="p-4 grid grid-cols-[1fr_120px] gap-4">
          <div>
            <label className="block text-[0.65rem] font-semibold uppercase tracking-wide text-txt-muted mb-1">
              Description of Work <span className="text-red">*</span>
            </label>
            <textarea
              value={entry.description}
              onChange={(e) => onChange(entry.id, 'description', e.target.value)}
              placeholder="e.g., Drafted motion for summary judgment; reviewed opposing counsel's brief and prepared response outline"
              rows={2}
              className="w-full bg-surface border-[1.5px] border-border rounded-cooley px-3 py-2 text-[0.82rem] text-txt font-sans resize-vertical transition-colors duration-200 focus:outline-none focus:border-red focus:bg-white placeholder:text-txt-muted"
            />
          </div>
          <div>
            <label className="block text-[0.65rem] font-semibold uppercase tracking-wide text-txt-muted mb-1">
              Hours <span className="text-red">*</span>
            </label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="24"
              value={entry.hours}
              onChange={(e) => onChange(entry.id, 'hours', e.target.value)}
              placeholder="0.0"
              className="w-full bg-surface border-[1.5px] border-border rounded-cooley px-3 py-2 text-[0.82rem] text-txt font-mono transition-colors duration-200 focus:outline-none focus:border-red focus:bg-white placeholder:text-txt-muted"
            />
          </div>
        </div>
      </div>

      {/* Feedback box — appears below the entry */}
      {fb && <FeedbackBox feedback={fb} onCitationClick={onCitationClick} />}
    </div>
  );
}

function FeedbackBox({ feedback, onCitationClick }) {
  const { billable, confidence, explanation, citation, citation_id, cited_text } = feedback;

  const colors = billable
    ? { bg: 'bg-green-bg', border: 'border-green-bd', text: 'text-green', icon: '✓', label: 'Likely Billable' }
    : { bg: 'bg-emerg-bg', border: 'border-emerg-bd', text: 'text-emerg-text', icon: '⚠', label: 'Potential Issue' };

  return (
    <div className={`mt-2 ${colors.bg} border ${colors.border} rounded-cooley p-4 animate-fade-in`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[0.85rem] ${colors.text}`}>{colors.icon}</span>
        <span className={`text-[0.78rem] font-semibold ${colors.text}`}>{colors.label}</span>
        {confidence && (
          <span className="font-mono text-[0.6rem] font-medium text-txt-muted bg-white border border-border px-1.5 py-0.5 rounded-[3px]">
            {confidence} confidence
          </span>
        )}
      </div>
      <p className="text-[0.82rem] text-txt-dim leading-relaxed mb-2">{explanation}</p>
      {cited_text && (
        <div className="bg-white/60 border border-border-strong/30 rounded-[3px] px-3 py-2 mb-2">
          <p className="text-[0.76rem] text-txt-dim italic leading-relaxed">"{cited_text}"</p>
        </div>
      )}
      {citation && (
        <button
          onClick={() => onCitationClick?.(citation_id)}
          className="flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 group"
        >
          <span className="text-[0.7rem] text-txt-muted">📎</span>
          <span className="font-mono text-[0.72rem] text-red font-medium group-hover:underline">
            {citation}
          </span>
          <span className="text-[0.6rem] text-txt-muted opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            — view in OCG →
          </span>
        </button>
      )}
    </div>
  );
}

function ChatCitation({ line, onCitationClick }) {
  // Strip leading 📎 if present
  const cleanLine = line.replace(/^📎\s*/, '');
  // Find section reference anywhere in the line
  const sectionMatch = cleanLine.match(/(Section\s+[\d.]+(?:\([a-z]\))?(?:\s*[—–-]\s*[^.]+)?)/i);
  
  let sectionId = null;
  if (sectionMatch) {
    const numMatch = sectionMatch[1].match(/Section\s+([\d.]+(?:\([a-z]\))?)/i);
    if (numMatch) {
      sectionId = 'section-' + numMatch[1].replace(/\./g, '-').replace(/[()]/g, '');
    }
  }

  // If the whole line is basically just a citation, render it as a button
  if (line.startsWith('📎') || cleanLine.trim().toLowerCase().startsWith('section')) {
    return (
      <button
        onClick={() => onCitationClick?.(sectionId)}
        className="flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 group inline-flex"
      >
        <span className="text-[0.7rem] text-txt-muted">📎</span>
        <span className="font-mono text-[0.72rem] text-red font-medium group-hover:underline">
          {cleanLine}
        </span>
        <span className="text-[0.6rem] text-txt-muted opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          → view
        </span>
      </button>
    );
  }

  // Otherwise, render the line with the section reference as a clickable inline link
  if (sectionMatch) {
    const idx = cleanLine.indexOf(sectionMatch[1]);
    const before = cleanLine.slice(0, idx);
    const citation = sectionMatch[1];
    const after = cleanLine.slice(idx + citation.length);
    return (
      <span>
        {before}
        <button
          onClick={() => onCitationClick?.(sectionId)}
          className="bg-transparent border-none cursor-pointer p-0 inline"
        >
          <span className="font-mono text-[0.72rem] text-red font-medium hover:underline">📎 {citation}</span>
        </button>
        {after}
      </span>
    );
  }

  return <span>{cleanLine}</span>;
}

function OcgChatPanel({ messages, input, loading, onInputChange, onSend, onCitationClick }) {
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="bg-white border border-border border-t-0 rounded-b-cooley shadow-sm overflow-hidden animate-fade-in">
      {/* Messages area */}
      <div className="h-[320px] overflow-y-auto px-5 py-4 flex flex-col gap-3 bg-surface/50">
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
            <div className="text-[1.5rem] mb-2">💬</div>
            <div className="text-[0.82rem] text-txt-dim mb-1">Ask anything about this OCG</div>
            <div className="text-[0.72rem] text-txt-muted max-w-xs">
              Try: "What activities are non-billable?" or "What are the travel billing rules?"
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 items-start ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-6 h-6 rounded shrink-0 flex items-center justify-center font-mono text-[0.5rem] font-semibold mt-0.5 ${
              msg.role === 'user'
                ? 'bg-wash border border-border-strong text-txt-dim'
                : 'bg-red text-white'
            }`}>
              {msg.role === 'user' ? 'YOU' : 'OCG'}
            </div>
            <div className={`max-w-[78%] px-3.5 py-2.5 text-[0.845rem] leading-relaxed ${
              msg.role === 'user'
                ? 'bg-red-light border border-red-mid rounded-[7px_2px_7px_7px] text-txt'
                : 'bg-white border border-border rounded-[2px_7px_7px_7px] text-txt'
            }`}>
              {msg.content.split('\n').map((line, j) => (
                <span key={j}>
                  {line.startsWith('📎') || /Section\s+[\d.]+(?:\([a-z]\))?/i.test(line) ? (
                    <ChatCitation line={line} onCitationClick={onCitationClick} />
                  ) : line}
                  {j < msg.content.split('\n').length - 1 && <br />}
                </span>
              ))}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-2.5 items-start">
            <div className="w-6 h-6 rounded shrink-0 flex items-center justify-center font-mono text-[0.5rem] font-semibold bg-red text-white mt-0.5">OCG</div>
            <div className="bg-white border border-border rounded-[2px_7px_7px_7px] px-3.5 py-2.5 flex items-center gap-1">
              <span className="w-[5px] h-[5px] bg-txt-muted rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-[5px] h-[5px] bg-txt-muted rounded-full animate-bounce" style={{ animationDelay: '180ms' }} />
              <span className="w-[5px] h-[5px] bg-txt-muted rounded-full animate-bounce" style={{ animationDelay: '360ms' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="px-5 py-3 border-t border-border bg-surface">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about billing rules, permitted activities, restrictions…"
            rows={1}
            className="flex-1 bg-white border-[1.5px] border-border rounded-cooley px-3 py-2 text-[0.845rem] text-txt font-sans resize-none min-h-[38px] max-h-[88px] overflow-y-auto transition-colors duration-200 focus:outline-none focus:border-red placeholder:text-txt-muted"
            style={{ height: 'auto' }}
            onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 88) + 'px'; }}
          />
          <button
            onClick={onSend}
            disabled={loading || !input.trim()}
            className="bg-red text-white border-none rounded-cooley px-4 h-[38px] text-[0.76rem] font-semibold cursor-pointer transition-colors duration-150 hover:bg-red-hover disabled:bg-txt-muted disabled:cursor-not-allowed shrink-0"
          >
            Send
          </button>
        </div>
        <div className="mt-1.5 font-mono text-[0.63rem] text-txt-muted">
          Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}

function OcgViewerModal({ ocg, anchor, onClose }) {
  const contentRef = useRef(null);

  useEffect(() => {
    if (anchor && contentRef.current) {
      const el = contentRef.current.querySelector(`[data-section-id="${anchor}"]`);
      if (el) {
        // Small delay to let the modal render
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      }
    }
  }, [anchor]);

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const sections = ocg.sections || [];

  return (
    <div
      className="fixed inset-0 bg-black/35 backdrop-blur-[3px] z-[200] flex items-center justify-center p-8 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white border border-border border-t-[3px] border-t-red rounded-cooley w-full max-w-[720px] max-h-[82vh] flex flex-col shadow-lg animate-slide-up">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <div className="font-mono text-[0.62rem] font-semibold uppercase tracking-widest text-red mb-1">
              OCG Document Viewer
            </div>
            <div className="font-serif text-[1.1rem] text-txt">{ocg.name}</div>
          </div>
          <button
            onClick={onClose}
            className="text-txt-muted hover:text-txt transition-colors duration-150 text-[1rem] bg-transparent border-none cursor-pointer shrink-0 ml-4"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-4">
          {sections.length === 0 ? (
            <div className="text-center py-8 text-txt-muted text-[0.82rem]">
              No sections available for this OCG.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {sections.map((section) => {
                const isHighlighted = anchor === section.id;
                return (
                  <div
                    key={section.id}
                    data-section-id={section.id}
                    className={`rounded-cooley border transition-all duration-300 ${
                      isHighlighted
                        ? 'border-red bg-red-light border-l-[3px] border-l-red shadow-md'
                        : 'border-border bg-white'
                    }`}
                  >
                    <div className={`px-4 py-2.5 border-b ${isHighlighted ? 'border-red-mid' : 'border-border'} bg-surface/50`}>
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-[0.65rem] font-semibold ${isHighlighted ? 'text-red' : 'text-txt-muted'}`}>
                          {section.id}
                        </span>
                        <span className={`text-[0.82rem] font-semibold ${isHighlighted ? 'text-red' : 'text-txt'}`}>
                          {section.title}
                        </span>
                        {isHighlighted && (
                          <span className="ml-auto font-mono text-[0.58rem] font-semibold bg-red text-white px-2 py-0.5 rounded-[3px]">
                            CITED
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <p className={`text-[0.82rem] leading-relaxed ${isHighlighted ? 'text-txt' : 'text-txt-dim'}`}>
                        {section.text}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border bg-surface shrink-0 flex items-center justify-between">
          <span className="font-mono text-[0.63rem] text-txt-muted">
            {sections.length} sections · {anchor ? `Viewing: ${anchor}` : 'Full document'}
          </span>
          <button
            onClick={onClose}
            className="bg-white text-txt-dim border border-border rounded-cooley px-4 py-1.5 text-[0.78rem] cursor-pointer transition-colors duration-150 hover:border-border-strong hover:text-txt"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
