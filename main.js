/* --- Hold Course --- v1.8.0 */ 
'use strict';

const {
  Plugin,
  PluginSettingTab,
  ItemView,
  Modal,
  Setting,
  Notice,
  Menu,
  setIcon,
  FuzzySuggestModal,
} = require('obsidian');

// ─── Constants ────────────────────────────────────────────────────────────────

const VIEW_TYPE = 'hold-course-view';
const TODAY_VIEW_TYPE = 'hold-course-today';

const COLOR_PALETTE = [
  { name: 'amber',  accent: '#BA7517', accentDark: '#E5A34F', light: '#FAC775', bg: '#FAEEDA', text: '#633806' },
  { name: 'teal',   accent: '#0F6E56', accentDark: '#45C4A0', light: '#9FE1CB', bg: '#E1F5EE', text: '#04342C' },
  { name: 'coral',  accent: '#993C1D', accentDark: '#E8845C', light: '#F5C4B3', bg: '#FAECE7', text: '#4A1B0C' },
  { name: 'purple', accent: '#534AB7', accentDark: '#A29AF2', light: '#CECBF6', bg: '#EEEDFE', text: '#26215C' },
  { name: 'pink',   accent: '#993556', accentDark: '#E886A8', light: '#F4C0D1', bg: '#FBEAF0', text: '#4B1528' },
  { name: 'green',  accent: '#3B6D11', accentDark: '#97C95E', light: '#C0DD97', bg: '#EAF3DE', text: '#173404' },
];

const ASSIGNMENT_TYPE_STYLE = {
  'Reading':    { color: '#0A3D8F', colorDark: '#7EAFF7', bg: '#E8F1FC' },
  'Writing':    { color: '#C05E0A', colorDark: '#F2A55A', bg: '#FAEADC' },
  'Quiz':       { color: '#A0235F', colorDark: '#F088BB', bg: '#F8E4EF' },
  'Exam':       { color: '#A0235F', colorDark: '#F088BB', bg: '#F8E4EF' },
  'Project':    { color: '#4A6FA5', colorDark: '#9BBCE9', bg: '#E4EBF5' },
  'Discussion': { color: '#5C7A00', colorDark: '#B3D45D', bg: '#EBF3D6' },
  'Other':      { color: '#666666', colorDark: '#A8A8A8', bg: '#F0F0F0' },
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Calendar "Show" filter entries.
const CAL_KIND_OPTIONS = [
  { value: null,         label: 'All' },
  { value: 'lecture',    label: 'Lectures' },
  { value: 'assignment', label: 'Assignments' },
  { value: 'exam',       label: 'Exams' },
];

const ASSIGNMENT_TYPES = ['Reading', 'Writing', 'Project', 'Discussion', 'Other'];

const TERMS = ['Winter', 'Spring', 'Summer', 'Fall'];

// Calendar order within a year. Consumed only through semesterRank() below.
const TERM_ORDER = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };

// Settable values. Absence of the key is the fourth state — "not set" — and it
// is the default, because the plugin genuinely does not know whether a class has
// started. Same reasoning as the semester parser: write null, never a guess.
const CLASS_STATUSES = ['ongoing', 'completed', 'dropped'];

// ─── Utilities ────────────────────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// A semester's position on the timeline. null means it has none at all — no
// year — and those sort last in BOTH directions, because reversing them would
// assert they are the oldest. A semester with a year but no term does have a
// position, just an imprecise one, so it reverses normally.
//
// Module-level rather than a method because both the plugin (deleteSemester)
// and the view (Courses sorting) need it, and they have no reference to each
// other. One definition, one rule.
function semesterRank(sem) {
  if (!sem || typeof sem.year !== 'number') return null;
  const t = sem.term in TERM_ORDER ? TERM_ORDER[sem.term] : -1;
  return sem.year * 10 + t;
}

// Ordering two semesters on the timeline. `dir` is 1 for oldest-first, -1 for
// newest-first. Undated semesters sort last in BOTH directions — the direction
// deliberately does not apply to them, because reversing them would assert they
// are the oldest, which is a claim the data does not support.
//
// Module-level for the same reason as semesterRank: this rule was written out by
// hand in three places (Courses primary sort, Courses secondary sort, and the
// semester switcher) and three copies is three chances to drift.
function compareSemestersByTimeline(a, b, dir = 1) {
  const ra = semesterRank(a);
  const rb = semesterRank(b);
  if (ra === null && rb === null) return 0;
  if (ra === null) return 1;
  if (rb === null) return -1;
  return dir * (ra - rb);
}

// Data-shape stamp. Absence of the key entirely is version 0 — the marker is the
// absence, not a stored zero. The number counts migrations applied, so a stamped
// file has been through both #1 (term/year parse) and #2 (semester removal).
//
// Migration #2 rewrites nothing. `removed` is presence-based and additive, so an
// old file simply has no such keys and every semester is visible, which is the
// correct answer already. The stamp ships anyway, and in the same commit, so the
// number never describes a coverage it does not have.
const CURRENT_DATA_VERSION = 2;

// A semester is hidden from the switcher when the key is present. Absent = visible,
// same presence-based pattern as class `status`. Nothing is archived, frozen, or
// made read-only — this governs one thing: whether the switcher draws it.
function isSemesterRemoved(sem) {
  return !!sem && 'removed' in sem;
}

function getColor(index) {
  return COLOR_PALETTE[index % COLOR_PALETTE.length];
}

function getTypeStyle(type) {
  return ASSIGNMENT_TYPE_STYLE[type] || ASSIGNMENT_TYPE_STYLE['Other'];
}

// Dark-theme awareness: pastel pills (light bg + dark text) are self-contained
// and safe on any theme, but accent colors used as text directly on the theme
// background need a brighter variant on dark themes.
function isDarkTheme() {
  return document.body.classList.contains('theme-dark');
}

function accentText(color) {
  return isDarkTheme() ? (color.accentDark || color.accent) : color.accent;
}

function typeText(style) {
  return isDarkTheme() ? (style.colorDark || style.color) : style.color;
}

function getTodayISO() {
  const d = new Date();
  return makeISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function getWeekEndISO() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return makeISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateWithDay(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function getDaysUntil(isoDate) {
  if (!isoDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(isoDate + 'T12:00:00');
  return Math.floor((target - today) / (1000 * 60 * 60 * 24));
}

function getDueInfo(isoDate) {
  const diff = getDaysUntil(isoDate);
  if (diff === null) return null;
  const dateStr = formatDate(isoDate);
  const amber     = isDarkTheme() ? '#E5A34F' : '#BA7517';
  const amberNote = isDarkTheme() ? '#E5A34F' : '#854F0B';
  if (diff < 0)  return { label: `${dateStr} · overdue`, color: '#E24B4A', note: 'Overdue', noteColor: '#A32D2D', urgency: 'overdue' };
  if (diff === 0) return { label: `${dateStr} · today`,   color: '#E24B4A', note: 'Today',   noteColor: '#A32D2D', urgency: 'today' };
  if (diff === 1) return { label: `${dateStr} · tomorrow`,color: amber, note: 'Tomorrow',noteColor: amberNote, urgency: 'soon' };
  if (diff <= 7)  return { label: `${dateStr} · ${diff} days`, color: amber, note: `${diff} days`, noteColor: amberNote, urgency: 'soon' };
  return { label: dateStr, color: 'var(--text-muted)', note: `${diff} days`, noteColor: 'var(--text-faint)', urgency: 'upcoming' };
}

function getAllAssignments(semester) {
  const all = [];
  for (const cls of (semester.classes || [])) {
    for (const a of (cls.assignments || [])) {
      all.push({ ...a, classId: cls.id, classCode: cls.code, colorIndex: cls.colorIndex });
    }
    for (const lec of (cls.lectures || [])) {
      for (const a of (lec.assignments || [])) {
        all.push({ ...a, classId: cls.id, classCode: cls.code, colorIndex: cls.colorIndex, lectureId: lec.id });
      }
    }
  }
  return all;
}

function getNextAssignmentDue(cls) {
  const pending = [];
  for (const a of (cls.assignments || [])) {
    if (a.status !== 'done' && a.dueDate) pending.push(a);
  }
  for (const lec of (cls.lectures || [])) {
    for (const a of (lec.assignments || [])) {
      if (a.status !== 'done' && a.dueDate) pending.push(a);
    }
  }
  if (!pending.length) return null;
  return pending.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
}

function getLecturesSorted(cls) {
  return [...(cls.lectures || [])].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
}

// ─── Bulk lecture paste parsing ───────────────────────────────────────────────

const BULK_MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const BULK_DAY_NUM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Inverse of BULK_DAY_NUM, indexed by Date.getDay() (0 = Sun). Used to test
// whether a given dateISO falls on one of a class's meetingDays.
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isValidYMD(year, month1, day) {
  if (month1 < 1 || month1 > 12 || day < 1) return false;
  const daysInMonth = new Date(year, month1, 0).getDate();
  return day <= daysInMonth;
}

// Parses a single trailing token as a date. Returns ISO string or null.
// Accepted: YYYY-MM-DD · "Aug 24" / "August 24, 2026" / "24 Aug" · 8/24 / 8/24/2026.
// Numeric form reads month-first; auto-flips when the first number can't be a month.
function parseBulkDateToken(token, defaultYear) {
  const t = token.trim();
  if (!t) return null;

  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    return isValidYMD(y, mo, d) ? makeISO(y, mo, d) : null;
  }

  m = t.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (m) {
    const mo = BULK_MONTHS[m[1].toLowerCase()];
    if (!mo) return null;
    const y = m[3] ? +m[3] : defaultYear, d = +m[2];
    return isValidYMD(y, mo, d) ? makeISO(y, mo, d) : null;
  }

  m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\.?(?:,?\s+(\d{4}))?$/);
  if (m) {
    const mo = BULK_MONTHS[m[2].toLowerCase()];
    if (!mo) return null;
    const y = m[3] ? +m[3] : defaultYear, d = +m[1];
    return isValidYMD(y, mo, d) ? makeISO(y, mo, d) : null;
  }

  m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    let mo = +m[1], d = +m[2];
    if (mo > 12 && d <= 12) { const tmp = mo; mo = d; d = tmp; }
    let y = defaultYear;
    if (m[3]) y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return isValidYMD(y, mo, d) ? makeISO(y, mo, d) : null;
  }

  return null;
}

// Splits a pasted line into { title, date }. Only a trailing tab- or
// comma-separated token that parses as a date is claimed; commas inside
// titles are safe. Lines that are nothing but a date stay titles.
function splitBulkLine(line, defaultYear) {
  const sepIdx = Math.max(line.lastIndexOf('\t'), line.lastIndexOf(','));
  if (sepIdx > 0) {
    const candidate = line.slice(sepIdx + 1);
    const title = line.slice(0, sepIdx).trim();
    if (title) {
      const iso = parseBulkDateToken(candidate, defaultYear);
      if (iso) return { title, date: iso };
    }
  }
  return { title: line.trim(), date: '' };
}

// Parses the full paste. opts = { startDate: ISO|'' , meetingDays: ['Mon',...] }.
// Auto-dating is active only when both a start date and at least one day are set.
// When active, interior blank lines consume a meeting slot (a skipped date);
// lines with an explicit date do not consume a slot. When inactive, blank
// lines are ignored. Leading/trailing blank lines are always ignored.
function parseBulkLectures(text, opts) {
  const startDate = (opts && opts.startDate) || '';
  const meetingDays = (opts && opts.meetingDays) || [];
  const patternActive = !!startDate && meetingDays.length > 0;
  const defaultYear = startDate ? +startDate.slice(0, 4) : new Date().getFullYear();

  let lines = text.split('\n').map(l => l.replace(/\s+$/, ''));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  let cursor = null;
  if (patternActive) {
    const dayNums = meetingDays.map(d => BULK_DAY_NUM[d]).filter(n => n !== undefined);
    const start = new Date(startDate + 'T12:00:00');
    cursor = { date: start, dayNums };
  }
  const nextSlot = () => {
    while (!cursor.dayNums.includes(cursor.date.getDay())) cursor.date.setDate(cursor.date.getDate() + 1);
    const iso = makeISO(cursor.date.getFullYear(), cursor.date.getMonth() + 1, cursor.date.getDate());
    cursor.date.setDate(cursor.date.getDate() + 1);
    return iso;
  };

  const rows = [];
  const counts = { lectures: 0, dated: 0, undated: 0, skipped: 0 };
  for (const raw of lines) {
    if (!raw.trim()) {
      if (patternActive) { rows.push({ kind: 'skip', date: nextSlot() }); counts.skipped++; }
      continue;
    }
    const { title, date } = splitBulkLine(raw, defaultYear);
    if (!title) continue;
    let finalDate = date;
    let source = date ? 'explicit' : 'none';
    if (!date && patternActive) { finalDate = nextSlot(); source = 'pattern'; }
    const wordCount = title.split(/\s+/).filter(Boolean).length;
    const shortTitle = title.length < 20 || wordCount < 3;
    rows.push({ kind: 'lecture', title, date: finalDate, source, shortTitle });
    counts.lectures++;
    if (finalDate) counts.dated++; else counts.undated++;
  }
  return { rows, counts, patternActive };
}

// Parses a bulk-assignment paste. Deliberately simpler than the lecture parser:
// there is no date syntax and no pattern engine — every non-blank line is one
// whole title (commas, page ranges, and chapter lists stay intact), and blank
// lines are ignored everywhere. Due date and type are supplied by the modal,
// not the text.
function parseBulkAssignments(text) {
  const lines = (text || '').split('\n');
  const rows = [];
  for (const raw of lines) {
    const title = raw.trim();
    if (!title) continue;
    rows.push({ title });
  }
  return { rows, counts: { assignments: rows.length } };
}

function getAssignmentsSorted(cls) {
  const items = [];
  for (const a of (cls.assignments || [])) {
    items.push({ assignment: a, lectureId: null });
  }
  for (const lec of getLecturesSorted(cls)) {
    for (const a of (lec.assignments || [])) {
      items.push({ assignment: a, lectureId: lec.id });
    }
  }
  items.sort((a, b) => {
    if (!a.assignment.dueDate && !b.assignment.dueDate) return 0;
    if (!a.assignment.dueDate) return 1;
    if (!b.assignment.dueDate) return -1;
    return a.assignment.dueDate.localeCompare(b.assignment.dueDate);
  });
  return items;
}

function getExamsSorted(cls) {
  return [...(cls.exams || [])].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}

function classStatusLabel(status) {
  if (!status) return '—';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// Conservative semester-name parser. Returns { term, year }, both null unless
// the name contains exactly one recognized term token AND exactly one plausible
// 4-digit year. A wrong guess sorts silently and permanently wrong with no
// visible cause; an honest null is fixable in five seconds. So: guess less.
function parseSemesterName(name) {
  const fail = { term: null, year: null };
  if (typeof name !== 'string') return fail;

  // \b guards reject FA26, 20265, and other near-misses outright.
  const years = name.match(/\b\d{4}\b/g) || [];
  if (years.length !== 1) return fail;

  const year = parseInt(years[0], 10);
  if (year < 1900 || year > 2199) return fail;

  const lower = name.toLowerCase();
  const found = [];
  for (const t of TERMS) {
    if (new RegExp('\\b' + t.toLowerCase() + '\\b').test(lower)) found.push(t);
  }
  if (/\bautumn\b/.test(lower) && found.indexOf('Fall') === -1) found.push('Fall');
  if (found.length !== 1) return fail;

  return { term: found[0], year };
}

function statusLabel(status) {
  if (status === 'done') return 'Done';
  if (status === 'in-progress') return 'In progress';
  return 'Not started';
}

function cycleStatus(status) {
  if (status === 'not-started') return 'in-progress';
  if (status === 'in-progress') return 'done';
  return 'not-started';
}

function formatDateLong(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// Stored as 24h "HH:MM"; displayed per locale. Anchored to an arbitrary date —
// only the time-of-day portion is used.
function formatTimeShort(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatTimeRange(startHHMM, endHHMM) {
  return `${formatTimeShort(startHHMM)} – ${formatTimeShort(endHHMM)}`;
}

// Storage stays 24h "HH:MM" everywhere — these only convert for display in
// the custom picker's hour/minute/AM-PM controls.
function parse24hTo12h(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  const period = h >= 12 ? 'PM' : 'AM';
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute: m, period };
}

function to24h(hour12, minute, period) {
  let h = hour12 % 12;
  if (period === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// Custom time picker — hour/minute dropdowns plus an AM/PM toggle styled
// like the day-toggle chips, replacing the native OS time control. 5-minute
// increments (typical class start times don't need finer). Renders a
// starting display (defaults to 9:00 AM when nothing is set yet) but only
// calls onChange on genuine user interaction — an untouched field leaves
// the underlying value empty, same as the native input did.
function renderTimePicker(contentEl, labelText, initialValue, onChange) {
  const setting = new Setting(contentEl).setName(labelText);
  const wrap = setting.controlEl.createDiv('hc-time-picker');

  const parsed = parse24hTo12h(initialValue) || { hour12: 9, minute: 0, period: 'AM' };
  let hour12 = parsed.hour12, minute = parsed.minute, period = parsed.period;

  const hourSel = wrap.createEl('select', { cls: 'hc-time-select' });
  for (let h = 1; h <= 12; h++) {
    const opt = hourSel.createEl('option', { text: String(h), value: String(h) });
    if (h === hour12) opt.selected = true;
  }

  wrap.createSpan({ cls: 'hc-time-colon', text: ':' });

  const minSel = wrap.createEl('select', { cls: 'hc-time-select' });
  for (let m = 0; m < 60; m += 5) {
    const opt = minSel.createEl('option', { text: String(m).padStart(2, '0'), value: String(m) });
    if (m === minute) opt.selected = true;
  }

  const toggle = wrap.createDiv('hc-time-period-toggle');
  const amBtn = toggle.createEl('button', { cls: 'hc-time-period-btn', text: 'AM', type: 'button' });
  const pmBtn = toggle.createEl('button', { cls: 'hc-time-period-btn', text: 'PM', type: 'button' });

  const applyPeriodStyle = () => {
    if (period === 'AM') { amBtn.addClass('hc-time-period-btn--active'); pmBtn.removeClass('hc-time-period-btn--active'); }
    else { pmBtn.addClass('hc-time-period-btn--active'); amBtn.removeClass('hc-time-period-btn--active'); }
  };
  applyPeriodStyle();

  const emit = () => onChange(to24h(hour12, minute, period));

  hourSel.addEventListener('change', () => { hour12 = Number(hourSel.value); emit(); });
  minSel.addEventListener('change', () => { minute = Number(minSel.value); emit(); });
  amBtn.addEventListener('click', () => { period = 'AM'; applyPeriodStyle(); emit(); });
  pmBtn.addEventListener('click', () => { period = 'PM'; applyPeriodStyle(); emit(); });
}

// Month/week grid pills are narrow, so a lecture that picked up a merged
// class time gets a short start-time prefix rather than the full range —
// enough to sort your day at a glance without crowding the cell.
function calItemDisplayTitle(item) {
  if (item.kind === 'lecture' && item.meetingStartTime) {
    return `${formatTimeShort(item.meetingStartTime)} · ${item.title}`;
  }
  return item.title;
}

function resourceStatusLabel(status) {
  if (status === 'done') return 'Done';
  if (status === 'in-progress') return 'In Progress';
  return 'Unread';
}

function cycleResourceStatus(status) {
  if (status === 'unread') return 'in-progress';
  if (status === 'in-progress') return 'done';
  return 'unread';
}

// ─── Calendar helpers ─────────────────────────────────────────────────────────

function makeISO(year, month1, day) {
  return `${year}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDaysISO(dateISO, n) {
  const d = new Date(dateISO + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return makeISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function getWeekStartISO(dateISO) {
  const d = new Date(dateISO + 'T12:00:00');
  const daysBack = (d.getDay() + 6) % 7; // Mon = 0
  return addDaysISO(dateISO, -daysBack);
}

// A class meets today by its recurring schedule only when every one of these
// is set and matches: meetingDays includes today's weekday, both times are
// set, and dateISO falls inside startDate/endDate inclusive. Any piece
// missing means no meeting today — this is what keeps every existing vault
// unchanged until all five §1.3 fields are filled in.
function classMeetsOnDate(cls, dateISO, weekdayName) {
  return !!(
    cls.meetingDays?.includes(weekdayName) &&
    cls.meetingStartTime && cls.meetingEndTime &&
    cls.startDate && cls.endDate &&
    dateISO >= cls.startDate && dateISO <= cls.endDate
  );
}

function getItemsForDate(sem, dateISO, filterClassId) {
  const items = [];
  const weekdayName = WEEKDAY_NAMES[new Date(dateISO + 'T12:00:00').getDay()];

  for (const cls of (sem.classes || [])) {
    if (filterClassId && cls.id !== filterClassId) continue;
    // Completed/dropped classes stop surfacing on every date-driven surface —
    // Today, Tomorrow, month, and week all read this same list.
    if (cls.status === 'completed' || cls.status === 'dropped') continue;

    let firstLectureItemToday = null;
    for (const lec of (cls.lectures || [])) {
      if (lec.date === dateISO) {
        const item = { kind: 'lecture', title: lec.title, cls, lec };
        items.push(item);
        if (!firstLectureItemToday) firstLectureItemToday = item;
      }
    }
    for (const a of (cls.assignments || [])) {
      if (a.dueDate === dateISO) {
        items.push({ kind: 'assignment', title: a.title, cls, assignment: a, lectureId: null });
      }
    }
    for (const lec of (cls.lectures || [])) {
      for (const a of (lec.assignments || [])) {
        if (a.dueDate === dateISO) {
          items.push({ kind: 'assignment', title: a.title, cls, assignment: a, lectureId: lec.id });
        }
      }
    }
    for (const exam of (cls.exams || [])) {
      if (exam.dueDate === dateISO) {
        items.push({ kind: 'exam', title: exam.title, cls, exam });
      }
    }

    // §1.3 — stamp the class's meeting time onto the first lecture already
    // on this date, when this date matches the class's recurring schedule.
    // No lecture, no stamp: nothing is invented on days without real data,
    // and a makeup lecture on an off-schedule day stays untimed, same as
    // lectures always have.
    if (firstLectureItemToday && classMeetsOnDate(cls, dateISO, weekdayName)) {
      firstLectureItemToday.meetingStartTime = cls.meetingStartTime;
      firstLectureItemToday.meetingEndTime   = cls.meetingEndTime;
    }
  }
  return items;
}

function getCalItemStyle(item) {
  if (item.kind === 'lecture') {
    const c = getColor(item.cls.colorIndex);
    return { color: c.accent, bg: c.bg };
  }
  if (item.kind === 'exam')       return getTypeStyle('Exam');
  if (item.kind === 'assignment') return getTypeStyle(item.assignment.type);
  return { color: '#666', bg: '#F0F0F0' };
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

class HoldCoursePlugin extends Plugin {
  async onload() {
    this.data = await this.loadData() || { currentSemesterId: null, semesters: [] };
    this.data.settings = this.data.settings || { einkMode: false };
    this.applyEinkClass();

    this.addSettingTab(new HoldCourseSettingTab(this.app, this));

    // Additive migrations: only ever write keys that were absent. saveData
    // directly rather than save() — no views exist yet at this point.
    let changed = this._migrateSemesters();
    if (this._migrateDataVersion()) changed = true;
    if (changed) await this.saveData(this.data);

    this.registerView(VIEW_TYPE, (leaf) => new HoldCourseView(leaf, this));
    this.registerView(TODAY_VIEW_TYPE, (leaf) => new HoldCourseTodayView(leaf, this));

    this.addRibbonIcon('graduation-cap', 'Hold Course', () => this.activateView());
    this.addRibbonIcon('calendar-clock', 'Hold Course — Today', () => this.activateTodayView());

    this.addCommand({
      id: 'open-hold-course',
      name: 'Open Hold Course',
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: 'open-hold-course-today',
      name: 'Open Hold Course — Today',
      callback: () => this.activateTodayView(),
    });

    this.addCommand({
      id: 'hc-add-class',
      name: 'Add a class',
      callback: () => {
        const sem = this._getActiveSemester();
        if (!sem) { new Notice('No active semester. Create one in Hold Course first.'); return; }
        new AddClassModal(this.app, this, sem.id, () => this.save()).open();
      },
    });

    this.addCommand({
      id: 'hc-open-calendar',
      name: 'Open calendar',
      callback: () => this.activateAndNavigate('calendar'),
    });

    this.addCommand({
      id: 'hc-show-global-assignments',
      name: 'Show global assignments',
      callback: () => this.activateAndNavigate('assignments'),
    });

    this.addCommand({
      id: 'hc-add-library-resource',
      name: 'Add a library resource',
      callback: () => {
        const sem = this._getActiveSemester();
        if (!sem) { new Notice('No active semester. Create one in Hold Course first.'); return; }
        new AddResourceModal(this.app, this, sem.id, sem.classes, () => this.save()).open();
      },
    });

    this.addCommand({
      id: 'hc-add-lecture',
      name: 'Add a lecture',
      callback: () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        const view = leaf?.view instanceof HoldCourseView ? leaf.view : null;
        if (!view || view.screen !== 'class' || !view.currentClassId) {
          new Notice('Navigate to a class first to add a lecture.');
          return;
        }
        // This command is class-scoped, so the semester must be the one the
        // class is actually in — which is not always the current semester once
        // Courses can show a class without switching terms.
        const sem = view._getViewedSemester();
        if (!sem) { new Notice('No active semester. Create one in Hold Course first.'); return; }
        new AddLectureModal(this.app, this, sem.id, view.currentClassId, () => {
          this.save();
          view.render();
        }).open();
      },
    });

    this.addCommand({
      id: 'hc-add-assignment',
      name: 'Add an assignment',
      callback: () => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        const view = leaf?.view instanceof HoldCourseView ? leaf.view : null;
        if (!view || view.screen !== 'class' || !view.currentClassId) {
          new Notice('Navigate to a class first to add an assignment.');
          return;
        }
        // Class-scoped: resolve the semester the class is in, not the current one.
        const sem = view._getViewedSemester();
        if (!sem) { new Notice('No active semester. Create one in Hold Course first.'); return; }
        const cls = (sem.classes || []).find(c => c.id === view.currentClassId);
        if (!cls) { new Notice('Could not find the current class.'); return; }
        new AddAssignmentModal(this.app, this, sem.id, cls, () => {
          this.save();
          view.render();
        }).open();
      },
    });

    this.app.workspace.onLayoutReady(() => {
      this.activateTodayView();
    });
  }

  onunload() {
    document.body.classList.remove('hc-eink');
  }

  applyEinkClass() {
    document.body.classList.toggle('hc-eink', this.data.settings.einkMode);
  }

  // #2: fires when an external process (e.g. a user's own sync script)
  // modifies data.json on disk, so changes show up without an Obsidian
  // restart. Deliberately a plain reload, not a merge: if an in-app edit
  // is mid-flight — mutated in memory but not yet written to disk — at
  // the exact same instant this fires, it's silently discarded in favor
  // of the on-disk version. A "flush before reload" approach (save
  // current in-memory state first) was considered and rejected: it would
  // overwrite the external change with our own stale copy before ever
  // reading it, defeating the purpose of this hook. A real fix would mean
  // merging field-by-field instead of replacing this.data wholesale — a
  // genuine data-load redesign, not a small addition. Given nearly every
  // action in this plugin already saves immediately after mutating data,
  // the actual unsaved-edit window is already close to zero in practice.
  // Accepting this as a known, low-probability limitation rather than
  // building the merge path preemptively. (LiveAQuietLife/Claude,
  // 2026-08-30 — see issue #2)
  async onExternalSettingsChange() {
    this.data = await this.loadData() || { currentSemesterId: null, semesters: [] };
    this.refreshTodayView();
    this.refreshMainView();
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async activateTodayView() {
    const { workspace } = this.app;
    if (workspace.getLeavesOfType(TODAY_VIEW_TYPE).length) return;
    const leaf = workspace.getRightLeaf(false);
    await leaf.setViewState({ type: TODAY_VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
  }

  async activateAndNavigate(screen) {
    await this.activateView();
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (leaf?.view instanceof HoldCourseView) leaf.view.navigate(screen);
  }

  _getActiveSemester() {
    const id = this.data.currentSemesterId;
    return this.data.semesters.find(s => s.id === id) || null;
  }

  refreshTodayView() {
    const leaves = this.app.workspace.getLeavesOfType(TODAY_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof HoldCourseTodayView) leaf.view.render();
    }
  }

  // Companion to refreshTodayView() — same pattern, main dashboard view.
  // Used by onExternalSettingsChange (#2) since a reload from disk needs
  // to repaint whatever screen the user's currently looking at, not just
  // the Today sidebar.
  refreshMainView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof HoldCourseView) leaf.view.refresh();
    }
  }

  async save() {
    await this.saveData(this.data);
    this.refreshTodayView();
  }

  // ─── Semester helpers ──────────────────────────────────────────────────────

  // One-time parse of term + year out of existing semester names. Guarded on the
  // *presence* of the key, not its truthiness, so a semester that parsed to null
  // (or that the user deliberately cleared) is never re-guessed on a later load.
  // Returns true if anything changed.
  _migrateSemesters() {
    let changed = false;
    for (const sem of (this.data.semesters || [])) {
      if ('term' in sem) continue;
      const parsed = parseSemesterName(sem.name || '');
      sem.term = parsed.term;
      sem.year = parsed.year;
      changed = true;
    }
    return changed;
  }

  // Migration #2. There is deliberately nothing to rewrite: `removed` is
  // presence-based, so an unstamped file already reads correctly as
  // "every semester visible". This writes the stamp and only the stamp, so that
  // migration #3 has a shape number to branch on instead of guessing from keys.
  _migrateDataVersion() {
    if ('dataVersion' in this.data) return false;
    this.data.dataVersion = CURRENT_DATA_VERSION;
    return true;
  }

  getCurrentSemester() {
    const sems = this.data.semesters || [];
    const byId = sems.find(s => s.id === this.data.currentSemesterId);
    // A removed semester must never be the current one. The invariant is enforced
    // at removal time; re-checking on read self-heals a hand-edited data.json
    // rather than showing a semester the switcher refuses to list.
    if (byId && !isSemesterRemoved(byId)) return byId;
    // Rank the fallback by timeline, not array order. Falling back to sems[0]
    // here would reintroduce exactly the bug fixed in 1.5.1's deleteSemester.
    // sems[0] survives only as a last resort for the degenerate case where every
    // semester is removed — showing something beats showing nothing.
    const fallbackId = this._mostRecentSemesterId();
    return sems.find(s => s.id === fallbackId) || sems[0] || null;
  }

  // Semesters the switcher draws. Courses deliberately does NOT use this — it is
  // the cross-semester record and shows everything regardless.
  visibleSemesters() {
    return (this.data.semesters || []).filter(s => !isSemesterRemoved(s));
  }

  removedSemesters() {
    return (this.data.semesters || []).filter(s => isSemesterRemoved(s));
  }

  // Hides a semester from the switcher. Nothing else changes: the object stays in
  // semesters[] with all its contents, and Courses keeps showing its classes as
  // fully editable. Refuses to hide the last visible semester — that would leave
  // the switcher with nothing to name and no route back except the restore list.
  removeSemesterFromList(id) {
    const sem = (this.data.semesters || []).find(s => s.id === id);
    if (!sem || isSemesterRemoved(sem)) return false;
    if (this.visibleSemesters().length <= 1) return false;
    sem.removed = true;
    if (this.data.currentSemesterId === id) {
      this.data.currentSemesterId = this._mostRecentSemesterId();
    }
    return true;
  }

  // The way back. Restores and selects in one action — you came here to go there.
  restoreSemester(id) {
    const sem = (this.data.semesters || []).find(s => s.id === id);
    if (!sem) return false;
    delete sem.removed;
    this.data.currentSemesterId = id;
    return true;
  }

  setCurrentSemester(id) {
    this.data.currentSemesterId = id;
  }

  addSemester(name, term = null, year = null) {
    const sem = {
      id: generateId(),
      name: name.trim(),
      term: term || null,
      year: (typeof year === 'number' && !isNaN(year)) ? year : null,
      classes: [],
    };
    if (!this.data.semesters) this.data.semesters = [];
    this.data.semesters.push(sem);
    if (!this.data.currentSemesterId) this.data.currentSemesterId = sem.id;
    return sem;
  }

  updateSemester(id, updates) {
    const sem = (this.data.semesters || []).find(s => s.id === id);
    if (!sem) return;
    if (typeof updates.name === 'string') sem.name = updates.name.trim();
    if ('term' in updates) sem.term = updates.term || null;
    if ('year' in updates) {
      sem.year = (typeof updates.year === 'number' && !isNaN(updates.year))
        ? updates.year
        : null;
    }
  }

  deleteSemester(id) {
    this.data.semesters = (this.data.semesters || []).filter(s => s.id !== id);
    if (this.data.currentSemesterId === id) {
      this.data.currentSemesterId = this._mostRecentSemesterId();
    }
  }

  // Which semester to land on after the current one goes away — by deletion or by
  // removal from the list. Most recent by timeline position, matching how Courses
  // orders them. Undated semesters lose to any dated one; if every survivor is
  // undated there is no basis to prefer one, so the first is as good an answer as
  // any. Only visible semesters are candidates: landing on a removed one would put
  // the switcher on a semester it refuses to list.
  _mostRecentSemesterId() {
    const sems = this.visibleSemesters();
    if (!sems.length) return null;
    let best = sems[0];
    let bestRank = semesterRank(best);
    for (let i = 1; i < sems.length; i++) {
      const rank = semesterRank(sems[i]);
      if (rank === null) continue;
      if (bestRank === null || rank > bestRank) {
        best = sems[i];
        bestRank = rank;
      }
    }
    return best.id;
  }

  // ─── Class helpers ─────────────────────────────────────────────────────────

  addClass(semesterId, classData) {
    const sem = this.data.semesters.find(s => s.id === semesterId);
    if (!sem) return null;
    const colorIndex = sem.classes.length % COLOR_PALETTE.length;
    const cls = {
      id: generateId(),
      colorIndex,
      code: classData.code.trim(),
      name: classData.name.trim(),
      courseUrl: (classData.courseUrl || '').trim(),
      meetingLink: (classData.meetingLink || '').trim(),
      professorName: classData.professorName.trim(),
      professorEmail: classData.professorEmail.trim(),
      officeHours: (classData.officeHours || '').trim(),
      taName: (classData.taName || '').trim(),
      taEmail: (classData.taEmail || '').trim(),
      taOfficeHours: (classData.taOfficeHours || '').trim(),
      meetingDays: classData.meetingDays || [],
      location: (classData.location || '').trim(),
      startDate: classData.startDate || '',
      endDate: classData.endDate || '',
      meetingStartTime: classData.meetingStartTime || '',
      meetingEndTime: classData.meetingEndTime || '',
      lectures: [],
      assignments: [],
      exams: [],
      resources: [],
    };
    sem.classes.push(cls);
    return cls;
  }

  updateClass(semesterId, classId, updates) {
    const cls = this.findClass(semesterId, classId);
    if (cls) Object.assign(cls, updates);
  }

  deleteClass(semesterId, classId) {
    const sem = this.data.semesters.find(s => s.id === semesterId);
    if (sem) sem.classes = sem.classes.filter(c => c.id !== classId);
  }

  findClass(semesterId, classId) {
    const sem = this.data.semesters.find(s => s.id === semesterId);
    return sem ? sem.classes.find(c => c.id === classId) : null;
  }

  // Every assignment on a class, class-level and lecture-nested alike. Both
  // places hold real assignments and both can carry a linkedBook.
  _allClassAssignments(cls) {
    const out = [...(cls.assignments || [])];
    for (const lec of (cls.lectures || [])) out.push(...(lec.assignments || []));
    return out;
  }

  // Semesters a class can be moved into. Removed semesters are deliberately
  // absent: removal takes away routes to a semester, and the answer is always
  // "restore it first". A move target list including them would be a second
  // route, reintroducing exactly what removal exists to prevent.
  moveTargetsFor(sourceSemesterId) {
    return this.visibleSemesters().filter(s => s.id !== sourceSemesterId);
  }

  // Moves a class, with everything inside it, into another semester.
  //
  // lectures/assignments/exams live *on* the class object and travel for free.
  // Resources do not: they live at sem.resources[] and only point at classes via
  // classIds, so they have to be handled explicitly or the class arrives with an
  // empty Library and its linkedBook references stop resolving.
  moveClass(sourceSemesterId, targetSemesterId, classId) {
    if (sourceSemesterId === targetSemesterId) return false;
    const source = (this.data.semesters || []).find(s => s.id === sourceSemesterId);
    const target = (this.data.semesters || []).find(s => s.id === targetSemesterId);
    if (!source || !target || isSemesterRemoved(target)) return false;

    const idx = (source.classes || []).findIndex(c => c.id === classId);
    if (idx === -1) return false;
    const cls = source.classes[idx];

    // Which resources this class actually depends on: the ones tagged to it, plus
    // any it links to without being tagged (possible if a tag was removed after
    // the link was made). Catching both means no linkedBook is left behind.
    const linked = new Set(
      this._allClassAssignments(cls).map(a => a.linkedBook).filter(Boolean)
    );
    const relevant = (source.resources || []).filter(
      r => (r.classIds || []).includes(classId) || linked.has(r.id)
    );

    if (!target.resources) target.resources = [];
    const idMap = new Map();

    for (const res of relevant) {
      const remaining = (res.classIds || []).filter(id => id !== classId);
      if (remaining.length === 0) {
        // Nothing left behind needs it — move the record itself. Same id, so
        // linkedBook keeps resolving with no remap.
        source.resources = source.resources.filter(r => r.id !== res.id);
        res.classIds = [classId];
        target.resources.push(res);
      } else {
        // Classes staying behind still reference it. Copy so neither side loses
        // anything. A NEW id, deliberately: reusing it would work today only
        // because every lookup is semester-scoped, and would be a landmine for a
        // future cross-semester Library.
        const copy = { ...res, id: generateId(), classIds: [classId] };
        res.classIds = remaining;
        target.resources.push(copy);
        idMap.set(res.id, copy.id);
      }
    }

    // Point the moved class's assignments at whichever record travelled with them.
    if (idMap.size) {
      for (const a of this._allClassAssignments(cls)) {
        if (a.linkedBook && idMap.has(a.linkedBook)) a.linkedBook = idMap.get(a.linkedBook);
      }
    }

    // colorIndex is positional by design, so it is reassigned on arrival —
    // carrying the old one over risks two classes rendering identically in the
    // target semester's dashboard grid.
    source.classes.splice(idx, 1);
    if (!target.classes) target.classes = [];
    cls.colorIndex = target.classes.length % COLOR_PALETTE.length;
    target.classes.push(cls);
    return true;
  }

  // ─── Lecture helpers ───────────────────────────────────────────────────────

  addLecture(semesterId, classId, lectureData) {
    const cls = this.findClass(semesterId, classId);
    if (!cls) return null;
    const lec = {
      id: generateId(),
      title: lectureData.title.trim(),
      date: lectureData.date || '',
      status: 'not-started',
      notes: '',
      vaultLink: '',
      assignments: [],
    };
    cls.lectures.push(lec);
    return lec;
  }

  updateLecture(semesterId, classId, lectureId, updates) {
    const lec = this.findLecture(semesterId, classId, lectureId);
    if (lec) Object.assign(lec, updates);
  }

  deleteLecture(semesterId, classId, lectureId) {
    const cls = this.findClass(semesterId, classId);
    if (cls) cls.lectures = cls.lectures.filter(l => l.id !== lectureId);
  }

  findLecture(semesterId, classId, lectureId) {
    const cls = this.findClass(semesterId, classId);
    return cls ? cls.lectures.find(l => l.id === lectureId) : null;
  }

  // ─── Assignment helpers ────────────────────────────────────────────────────

  addAssignment(semesterId, classId, lectureId, data) {
    const cls = this.findClass(semesterId, classId);
    if (!cls) return null;
    const assign = {
      id: generateId(),
      title: data.title.trim(),
      type: data.type || 'Other',
      dueDate: data.dueDate || '',
      status: 'not-started',
      notes: '',
      grade: '',
      linkedBook: '',
      linkedNote: '',
    };
    if (lectureId) {
      const lec = (cls.lectures || []).find(l => l.id === lectureId);
      if (lec) { lec.assignments.push(assign); return assign; }
    }
    cls.assignments.push(assign);
    return assign;
  }

  updateAssignment(semesterId, classId, assignmentId, updates) {
    const result = this.findAssignment(semesterId, classId, assignmentId);
    if (result) Object.assign(result.assignment, updates);
  }

  deleteAssignment(semesterId, classId, assignmentId) {
    const cls = this.findClass(semesterId, classId);
    if (!cls) return;
    const clsIdx = (cls.assignments || []).findIndex(a => a.id === assignmentId);
    if (clsIdx !== -1) { cls.assignments.splice(clsIdx, 1); return; }
    for (const lec of (cls.lectures || [])) {
      const lecIdx = (lec.assignments || []).findIndex(a => a.id === assignmentId);
      if (lecIdx !== -1) { lec.assignments.splice(lecIdx, 1); return; }
    }
  }

  findAssignment(semesterId, classId, assignmentId) {
    const cls = this.findClass(semesterId, classId);
    if (!cls) return null;
    const classLevel = (cls.assignments || []).find(a => a.id === assignmentId);
    if (classLevel) return { assignment: classLevel, lectureId: null };
    for (const lec of (cls.lectures || [])) {
      const found = (lec.assignments || []).find(a => a.id === assignmentId);
      if (found) return { assignment: found, lectureId: lec.id };
    }
    return null;
  }

  moveAssignment(semesterId, classId, assignmentId, newLectureId) {
    const cls = this.findClass(semesterId, classId);
    if (!cls) return;

    // Find and remove from current location
    let assignment = null;
    const clsIdx = (cls.assignments || []).findIndex(a => a.id === assignmentId);
    if (clsIdx !== -1) {
      assignment = cls.assignments.splice(clsIdx, 1)[0];
    } else {
      for (const lec of (cls.lectures || [])) {
        const lecIdx = (lec.assignments || []).findIndex(a => a.id === assignmentId);
        if (lecIdx !== -1) {
          assignment = lec.assignments.splice(lecIdx, 1)[0];
          break;
        }
      }
    }

    if (!assignment) return;

    // Place in new location
    if (newLectureId) {
      const targetLec = (cls.lectures || []).find(l => l.id === newLectureId);
      if (targetLec) { targetLec.assignments.push(assignment); return; }
    }
    cls.assignments.push(assignment);
  }

  // ─── Exam helpers ──────────────────────────────────────────────────────────

  addExam(semesterId, classId, data) {
    const cls = this.findClass(semesterId, classId);
    if (!cls) return null;
    if (!cls.exams) cls.exams = [];
    const exam = {
      id: generateId(),
      title: data.title.trim(),
      dueDate: data.dueDate || '',
      notes: '',
      grade: '',
      status: 'not-started',
    };
    cls.exams.push(exam);
    return exam;
  }

  updateExam(semesterId, classId, examId, updates) {
    const exam = this.findExam(semesterId, classId, examId);
    if (exam) Object.assign(exam, updates);
  }

  deleteExam(semesterId, classId, examId) {
    const cls = this.findClass(semesterId, classId);
    if (cls) cls.exams = (cls.exams || []).filter(e => e.id !== examId);
  }

  findExam(semesterId, classId, examId) {
    const cls = this.findClass(semesterId, classId);
    return cls ? (cls.exams || []).find(e => e.id === examId) : null;
  }

  // ─── Resource helpers ──────────────────────────────────────────────────────

  addResource(semesterId, data) {
    const sem = this.data.semesters.find(s => s.id === semesterId);
    if (!sem) return null;
    if (!sem.resources) sem.resources = [];
    const resource = {
      id: generateId(),
      title: data.title.trim(),
      author: (data.author || '').trim(),
      type: (data.type || '').trim(),
      classIds: data.classIds || [],
      status: data.status || 'unread',
      vaultLink: (data.vaultLink || '').trim(),
      url: (data.url || '').trim(),
      notes: '',
    };
    sem.resources.push(resource);
    return resource;
  }

  updateResource(semesterId, resourceId, updates) {
    const resource = this.findResource(semesterId, resourceId);
    if (resource) Object.assign(resource, updates);
  }

  deleteResource(semesterId, resourceId) {
    const sem = this.data.semesters.find(s => s.id === semesterId);
    if (sem) sem.resources = (sem.resources || []).filter(r => r.id !== resourceId);
  }

  findResource(semesterId, resourceId) {
    const sem = this.data.semesters.find(s => s.id === semesterId);
    return sem ? (sem.resources || []).find(r => r.id === resourceId) : null;
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

class HoldCourseSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Grayscale display mode')
      .setDesc('Increases text contrast and size for e-ink displays (e.g. Boox tablets) or a phone/tablet set to grayscale — both wash out low-contrast text the same way.')
      .addToggle((toggle) => toggle
        .setValue(this.plugin.data.settings.einkMode)
        .onChange(async (value) => {
          this.plugin.data.settings.einkMode = value;
          this.plugin.applyEinkClass();
          await this.plugin.save();
        }));
  }
}

// ─── View ─────────────────────────────────────────────────────────────────────

class HoldCourseView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.screen = 'dashboard';
    this.currentClassId = null;
    this.currentLectureId = null;
    this.currentAssignmentId = null;
    this.currentExamId = null;
    this.currentResourceId = null;
    // Which semester the current detail screens resolve against. Transient view
    // state, NOT plugin.data.currentSemesterId — deliberately a different name so
    // the two can never be confused. null = fall back to the current semester.
    this.viewedSemesterId = null;
    this.currentTab = 'Lectures';
    this.previousScreen = null;
    this.globalAssignFilterClassId = null;
    this.globalAssignFilterType = null;
    this.classAssignFilterType = null;
    this.libraryFilterClassId = null;
    this.coursesFilterYear = null;
    this.coursesFilterTerm = null;
    this.coursesSortKey = 'semester';
    this.coursesSortDir = 'desc';
    // Calendar session state
    this.calView = 'month';
    this.calYear = null;
    this.calMonth = null;
    this.calWeekStart = null;
    this.calFilterClassId = null;
    this.calFilterKind = null; // null='All' | 'lecture' | 'assignment' | 'exam'
    this.calFilterType = null; // ASSIGNMENT_TYPES value; only meaningful when calFilterKind === 'assignment'
    // Track open dropdown cleanup
    this._semDropEl = null;
    this._semCloseHandler = null;
    this._calPopoverEl = null;
    this._calPopoverCloseHandler = null;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Hold Course'; }
  getIcon() { return 'graduation-cap'; }

  async onOpen() { this.render(); }
  async onClose() { this._closeSemDrop(); this._closeCalPopover(); }

  navigate(screen, classId = null, lectureId = null, assignmentId = null, examId = null, resourceId = null, semesterId = null) {
    // Which semester the detail screens resolve against. Deliberately gated on
    // classId alone, NOT on screen === 'class': the calendar and the Today
    // sidebar navigate straight to 'lecture'/'assignment' without ever passing
    // through a class screen, so a screen-gated reset would let a stale id from
    // an earlier Courses click survive and resolve the wrong semester.
    //
    // Same class = staying inside one class's subtree (back, prev/next, tabs),
    // where call sites pass cls.id straight back in and never carry the
    // semester — so the value must persist untouched. Different class = a real
    // context change; take whatever was passed, or null to fall back.
    if (classId !== this.currentClassId) {
      this.viewedSemesterId = semesterId;
    }
    // Reset tab and library filter when moving to a different class
    if (screen === 'class' && classId !== this.currentClassId) {
      this.currentTab = 'Lectures';
      this.libraryFilterClassId = null;
      this.classAssignFilterType = null;
    }
    this.previousScreen = this.screen;
    this.screen = screen;
    this.currentClassId = classId;
    this.currentLectureId = lectureId;
    this.currentAssignmentId = assignmentId;
    this.currentExamId = examId;
    this.currentResourceId = resourceId;
    this.render();
  }

  // The semester the detail screens resolve against. Falls back to the current
  // semester whenever no transient id is set, which is every route except a
  // click through from Courses. Detail renderers use this; genuinely
  // current-semester surfaces (dashboard, assignments, calendar, Today) call
  // plugin.getCurrentSemester() directly and should keep doing so.
  _getViewedSemester() {
    if (this.viewedSemesterId) {
      const sem = (this.plugin.data.semesters || []).find(s => s.id === this.viewedSemesterId);
      if (sem) return sem;
    }
    return this.plugin.getCurrentSemester();
  }

  navigateTab(tab) {
    this.currentTab = tab;
    this.render();
  }

  refresh() { this.render(); }

  render() {
    this._closeSemDrop();
    this._closeCalPopover();

    this.contentEl.empty();
    const root = this.contentEl.createDiv('hc-root');

    this._renderToolbar(root);

    const content = root.createDiv('hc-content');

    switch (this.screen) {
      case 'dashboard':    this._renderDashboard(content); break;
      case 'class':        this._renderClassView(content); break;
      case 'lecture':      this._renderLectureDetail(content); break;
      case 'assignment':   this._renderAssignmentDetail(content); break;
      case 'exam':         this._renderExamDetail(content); break;
      case 'resource':     this._renderResourceDetail(content); break;
      case 'assignments':  this._renderAssignmentsView(content); break;
      case 'calendar':     this._renderCalendarView(content); break;
      case 'courses':      this._renderCoursesView(content); break;
      default:             this._renderDashboard(content);
    }
  }

  // ─── Toolbar ──────────────────────────────────────────────────────────────

  _renderToolbar(root) {
    const toolbar = root.createDiv('hc-toolbar');

    // Logo
    const logo = toolbar.createDiv('hc-logo');
    logo.createSpan({ text: 'Hold' });
    logo.createSpan({ cls: 'hc-logo-accent', text: 'Course' });

    // Breadcrumb
    const bc = toolbar.createDiv('hc-breadcrumb');
    this._renderBreadcrumb(bc);

    // Nav buttons
    const nav = toolbar.createDiv('hc-nav');
    const navItems = [
      { screen: 'dashboard',   icon: 'layout-grid', label: 'Overview' },
      { screen: 'assignments', icon: 'list',         label: 'Assignments' },
      { screen: 'calendar',    icon: 'calendar',     label: 'Calendar' },
      { screen: 'courses',     icon: 'graduation-cap', label: 'Courses' },
    ];

    for (const item of navItems) {
      const btn = nav.createEl('button', { cls: 'hc-nav-btn' });
      if (this.screen === item.screen) btn.addClass('hc-nav-btn--active');
      const iconSpan = btn.createSpan({ cls: 'hc-nav-icon' });
      setIcon(iconSpan, item.icon);
      btn.createSpan({ text: item.label });
      btn.addEventListener('click', () => this.navigate(item.screen));
    }
  }

  _renderBreadcrumb(bc) {
    const sem = this._getViewedSemester();
    if (!sem || ['dashboard', 'assignments', 'calendar', 'courses'].includes(this.screen)) return;

    // The root names the route you actually took. viewedSemesterId is set only by
    // a click through from Courses, so its presence *is* "you came from Courses" —
    // read as state, not history, which is why it survives drilling down and does
    // not need a second field to track it.
    const fromCourses = !!this.viewedSemesterId;
    const rootLabel = fromCourses ? 'Courses' : 'Overview';
    const ovBtn = bc.createEl('button', { cls: 'hc-bc-link', text: rootLabel });
    ovBtn.addEventListener('click', () => this.navigate(fromCourses ? 'courses' : 'dashboard'));

    // Semester, always — never conditionally. The switcher is drawn only on the
    // dashboard, so on a detail screen this is the one place the term appears. A
    // segment that came and went would mean "whatever the switcher said last time
    // you were on Overview", which is a memory task rather than a reading task.
    // Plain text: there is nowhere sensible for it to navigate.
    bc.createSpan({ cls: 'hc-bc-sep', text: '›' });
    bc.createSpan({ cls: 'hc-bc-sem', text: sem.name });

    if (this.screen === 'class' && this.currentClassId) {
      const cls = sem.classes.find(c => c.id === this.currentClassId);
      if (cls) {
        bc.createSpan({ cls: 'hc-bc-sep', text: '›' });
        const span = bc.createSpan({ text: cls.code });
        span.style.color = accentText(getColor(cls.colorIndex));
        span.style.fontWeight = '500';
        span.style.fontSize = '12px';
      }
    }

    if (this.screen === 'lecture' && this.currentClassId && this.currentLectureId) {
      const cls = sem.classes.find(c => c.id === this.currentClassId);
      if (cls) {
        bc.createSpan({ cls: 'hc-bc-sep', text: '›' });
        const clsBtn = bc.createEl('button', { cls: 'hc-bc-link', text: cls.code });
        clsBtn.style.color = accentText(getColor(cls.colorIndex));
        clsBtn.style.fontWeight = '500';
        clsBtn.addEventListener('click', () => this.navigate('class', cls.id));

        const sorted = getLecturesSorted(cls);
        const idx = sorted.findIndex(l => l.id === this.currentLectureId);
        if (idx !== -1) {
          bc.createSpan({ cls: 'hc-bc-sep', text: '›' });
          bc.createSpan({ cls: 'hc-bc-link', text: `Lecture ${idx + 1}` });
        }
      }
    }

    if (this.screen === 'assignment' && this.currentClassId && this.currentAssignmentId) {
      const cls = sem.classes.find(c => c.id === this.currentClassId);
      if (cls) {
        // #9: land back on Readings, not Assignments, for a Reading item —
        // it doesn't live in the Assignments list anymore. (LiveAQuietLife, 2026-09-01)
        const bcResult = this.plugin.findAssignment(sem.id, cls.id, this.currentAssignmentId);
        const bcIsReading = !!(bcResult && bcResult.assignment && bcResult.assignment.type === 'Reading');
        bc.createSpan({ cls: 'hc-bc-sep', text: '›' });
        const clsBtn = bc.createEl('button', { cls: 'hc-bc-link', text: cls.code });
        clsBtn.style.color = accentText(getColor(cls.colorIndex));
        clsBtn.style.fontWeight = '500';
        clsBtn.addEventListener('click', () => {
          this.currentTab = bcIsReading ? 'Readings' : 'Assignments';
          this.navigate('class', cls.id);
        });
        bc.createSpan({ cls: 'hc-bc-sep', text: '›' });
        bc.createSpan({ cls: 'hc-bc-link', text: 'Assignment' });
      }
    }

    if (this.screen === 'exam' && this.currentClassId && this.currentExamId) {
      const cls = sem.classes.find(c => c.id === this.currentClassId);
      if (cls) {
        bc.createSpan({ cls: 'hc-bc-sep', text: '›' });
        const clsBtn = bc.createEl('button', { cls: 'hc-bc-link', text: cls.code });
        clsBtn.style.color = accentText(getColor(cls.colorIndex));
        clsBtn.style.fontWeight = '500';
        clsBtn.addEventListener('click', () => {
          this.currentTab = 'Exams';
          this.navigate('class', cls.id);
        });
        bc.createSpan({ cls: 'hc-bc-sep', text: '›' });
        bc.createSpan({ cls: 'hc-bc-link', text: 'Exam' });
      }
    }

    if (this.screen === 'resource' && this.currentClassId && this.currentResourceId) {
      const cls = sem.classes.find(c => c.id === this.currentClassId);
      if (cls) {
        bc.createSpan({ cls: 'hc-bc-sep', text: '›' });
        const clsBtn = bc.createEl('button', { cls: 'hc-bc-link', text: cls.code });
        clsBtn.style.color = accentText(getColor(cls.colorIndex));
        clsBtn.style.fontWeight = '500';
        clsBtn.addEventListener('click', () => {
          this.currentTab = 'Library';
          this.navigate('class', cls.id);
        });
        bc.createSpan({ cls: 'hc-bc-sep', text: '›' });
        bc.createSpan({ cls: 'hc-bc-link', text: 'Resource' });
      }
    }
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  _renderDashboard(content) {
    const sem = this.plugin.getCurrentSemester();

    // Header row
    const header = content.createDiv('hc-dash-header');
    const titleWrap = header.createDiv('hc-dash-title-wrap');

    // Semester switcher
    const semWrap = titleWrap.createDiv('hc-sem-wrap');
    const semBtn = semWrap.createEl('button', { cls: 'hc-sem-btn' });
    semBtn.createSpan({ cls: 'hc-sem-btn-text', text: sem ? sem.name : 'No semester' });
    const chevronSpan = semBtn.createSpan({ cls: 'hc-sem-chevron' });
    setIcon(chevronSpan, 'chevron-down');

    // Stats subtitle
    if (sem) {
      const cls = sem.classes;
      const parts = [`${cls.length} ${cls.length === 1 ? 'class' : 'classes'}`];
      titleWrap.createDiv({ cls: 'hc-dash-subtitle', text: parts.join(' · ') });
    }

    // Semester dropdown logic
    semBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._semDropEl) { this._closeSemDrop(); return; }

      const drop = semWrap.createDiv('hc-sem-drop');
      this._semDropEl = drop;

      // Chronological, oldest at top — you read down through time. Previously
      // this was creation order, which put a semester wherever you happened to
      // add it. Undated semesters fall to the bottom.
      const switcherSems = [...this.plugin.visibleSemesters()]
        .sort((a, b) => compareSemestersByTimeline(a, b, 1));
      for (const s of switcherSems) {
        const item = drop.createDiv('hc-sem-drop-item');
        if (s.id === sem?.id) item.addClass('hc-sem-drop-item--active');
        const iconSpan = item.createSpan({ cls: 'hc-sem-drop-icon' });
        if (s.id === sem?.id) setIcon(iconSpan, 'check');
        item.createSpan({ text: s.name });
        item.addEventListener('click', () => {
          this.plugin.setCurrentSemester(s.id);
          this.plugin.save();
          this._closeSemDrop();
          this.render();
        });
      }

      drop.createDiv('hc-sem-drop-divider');

      const newItem = drop.createDiv('hc-sem-drop-item');
      const plusSpan = newItem.createSpan({ cls: 'hc-sem-drop-icon' });
      setIcon(plusSpan, 'plus');
      newItem.createSpan({ text: 'New semester' });
      newItem.addEventListener('click', () => {
        this._closeSemDrop();
        new AddSemesterModal(this.app, this.plugin, () => {
          this.plugin.save();
          this.render();
        }).open();
      });

      // Appears only when there is something to show. A permanent entry here would
      // advertise a state you are not in.
      const removedCount = this.plugin.removedSemesters().length;
      if (removedCount > 0) {
        const showRemovedItem = drop.createDiv('hc-sem-drop-item');
        const eyeSpan = showRemovedItem.createSpan({ cls: 'hc-sem-drop-icon' });
        setIcon(eyeSpan, 'eye');
        showRemovedItem.createSpan({ text: 'Show removed semesters' });
        showRemovedItem.addEventListener('click', () => {
          this._closeSemDrop();
          new RemovedSemestersModal(this.app, this.plugin, () => {
            this.plugin.save();
            this.render();
          }).open();
        });
      }

      if (sem) {
        drop.createDiv('hc-sem-drop-divider');

        const renameItem = drop.createDiv('hc-sem-drop-item');
        const renameIcon = renameItem.createSpan({ cls: 'hc-sem-drop-icon' });
        setIcon(renameIcon, 'pencil');
        renameItem.createSpan({ text: 'Edit semester' });
        renameItem.addEventListener('click', () => {
          this._closeSemDrop();
          new EditSemesterModal(this.app, this.plugin, sem, () => {
            this.plugin.save();
            this.render();
          }).open();
        });

        // Only when there is somewhere to land. Hiding the last visible semester
        // would leave the switcher naming nothing.
        if (this.plugin.visibleSemesters().length > 1) {
          const removeItem = drop.createDiv('hc-sem-drop-item');
          const removeIcon = removeItem.createSpan({ cls: 'hc-sem-drop-icon' });
          setIcon(removeIcon, 'eye-off');
          removeItem.createSpan({ text: 'Remove from list' });
          removeItem.addEventListener('click', () => {
            this._closeSemDrop();
            const commit = () => {
              const name = sem.name;
              if (this.plugin.removeSemesterFromList(sem.id)) {
                this.plugin.save();
                this.render();
                new Notice(`"${name}" removed from the switcher. Its classes are still in Courses.`);
              }
            };
            // Light explainer, once. It is reversible, so it does not need to
            // frighten anyone — after the first time the action just happens.
            if (this.plugin.data.seenRemoveExplainer) {
              commit();
            } else {
              new RemoveSemesterModal(this.app, this.plugin, sem, () => {
                this.plugin.data.seenRemoveExplainer = true;
                commit();
              }).open();
            }
          });
        }

        const deleteItem = drop.createDiv('hc-sem-drop-item hc-sem-drop-item--danger');
        const deleteIcon = deleteItem.createSpan({ cls: 'hc-sem-drop-icon' });
        setIcon(deleteIcon, 'trash-2');
        deleteItem.createSpan({ text: 'Delete semester' });
        deleteItem.addEventListener('click', () => {
          this._closeSemDrop();
          new DeleteSemesterModal(this.app, this.plugin, sem, () => {
            this.plugin.save();
            this.render();
          }).open();
        });
      }

      this._semCloseHandler = (ev) => {
        if (!semWrap.contains(ev.target)) this._closeSemDrop();
      };
      setTimeout(() => document.addEventListener('click', this._semCloseHandler, true), 0);
    });

    // Add class button
    const addBtn = header.createEl('button', { cls: 'hc-btn' });
    const addIcon = addBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(addIcon, 'plus');
    addBtn.createSpan({ text: 'Add class' });
    addBtn.addEventListener('click', () => {
      if (!sem) { new Notice('Create a semester first.'); return; }
      new AddClassModal(this.app, this.plugin, sem.id, () => {
        this.plugin.save();
        this.render();
      }).open();
    });

    // Empty state — no semester
    if (!sem) {
      const empty = content.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'Create a semester to get started.' });
      const btn = empty.createEl('button', { cls: 'hc-btn', text: 'Create semester' });
      btn.addEventListener('click', () => {
        new AddSemesterModal(this.app, this.plugin, () => {
          this.plugin.save();
          this.render();
        }).open();
      });
      return;
    }

    // Today strip
    this._renderTodayStrip(content, sem);

    // Classes section
    const section = content.createDiv('hc-section');
    section.createDiv({ cls: 'hc-section-label', text: 'Classes' });

    if (sem.classes.length === 0) {
      const empty = section.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'No classes yet. Add your first class above.' });
      return;
    }

    const grid = section.createDiv('hc-class-grid');
    for (const cls of sem.classes) {
      this._renderClassCard(grid, cls, sem.id);
    }
  }

  _renderTodayStrip(content, sem) {
    const today = getTodayISO();

    const dueToday = getAllAssignments(sem)
      .filter(a => a.status !== 'done' && a.dueDate === today)
      .sort((a, b) => a.title.localeCompare(b.title));

    const comingUp = getAllAssignments(sem)
      .filter(a => a.status !== 'done' && a.dueDate && a.dueDate > today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .slice(0, 5);

    const overdue = getAllAssignments(sem)
      .filter(a => a.status !== 'done' && a.dueDate && a.dueDate < today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    const strip = content.createDiv('hc-today-strip');

    // Overdue — only rendered when something is actually overdue
    if (overdue.length) {
      const overdueCol = strip.createDiv('hc-today-col');
      overdueCol.createDiv({ cls: 'hc-today-label hc-today-label--overdue', text: 'Overdue' });
      const shown = overdue.slice(0, 5);
      for (const a of shown) {
        const info = getDueInfo(a.dueDate);
        const row = overdueCol.createDiv('hc-today-row');
        const dot = row.createDiv('hc-today-dot');
        dot.style.background = info ? info.color : '#999';
        row.createSpan({ text: `${a.title} · ${formatDate(a.dueDate)}` });
      }
      if (overdue.length > shown.length) {
        const moreRow = overdueCol.createDiv('hc-today-row hc-today-empty');
        moreRow.createSpan({ text: `+${overdue.length - shown.length} more overdue` });
      }
    }

    // Left: Due today — always shown, empty state if nothing
    const leftCol = strip.createDiv('hc-today-col');
    leftCol.createDiv({ cls: 'hc-today-label', text: 'Due today' });
    if (dueToday.length) {
      for (const a of dueToday) {
        const info = getDueInfo(a.dueDate);
        const row = leftCol.createDiv('hc-today-row');
        const dot = row.createDiv('hc-today-dot');
        dot.style.background = info ? info.color : '#999';
        row.createSpan({ text: a.title });
      }
    } else {
      const emptyRow = leftCol.createDiv('hc-today-row hc-today-empty');
      emptyRow.createSpan({ text: 'No assignments due today.' });
    }

    // Right: Coming up — always shown, empty state if nothing
    const rightCol = strip.createDiv('hc-today-col');
    rightCol.createDiv({ cls: 'hc-today-label', text: 'Coming up' });
    if (comingUp.length) {
      for (const a of comingUp) {
        const info = getDueInfo(a.dueDate);
        const row = rightCol.createDiv('hc-today-row');
        const dot = row.createDiv('hc-today-dot');
        dot.style.background = info ? info.color : '#999';
        row.createSpan({ text: `${a.title} · ${formatDate(a.dueDate)}` });
      }
    } else {
      const emptyRow = rightCol.createDiv('hc-today-row hc-today-empty');
      emptyRow.createSpan({ text: 'Nothing coming up.' });
    }
  }

  _renderClassCard(container, cls, semesterId) {
    const color = getColor(cls.colorIndex);
    const next = getNextAssignmentDue(cls);

    const card = container.createDiv('hc-class-card');

    // Color bar
    const bar = card.createDiv('hc-class-bar');
    bar.style.background = color.accent;

    // Card body
    const body = card.createDiv('hc-class-body');

    // Code row with more button
    const codeRow = body.createDiv('hc-class-card-header');
    const codeEl = codeRow.createDiv({ cls: 'hc-class-code', text: cls.code });
    codeEl.style.color = accentText(color);

    const moreBtn = codeRow.createEl('button', { cls: 'hc-card-more-btn' });
    setIcon(moreBtn, 'more-horizontal');
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = new Menu();
      menu.addItem(item => item.setTitle('Edit class').setIcon('pencil').onClick(() => {
        new EditClassModal(this.app, this.plugin, semesterId, cls, () => {
          this.plugin.save();
          this.render();
        }).open();
      }));
      // Reversible, so it groups with Edit above the separator rather than with
      // Delete below it. Hidden when there is nowhere to move to.
      if (this.plugin.moveTargetsFor(semesterId).length) {
        menu.addItem(item => item.setTitle('Move to semester…').setIcon('arrow-right-left').onClick(() => {
          new MoveClassModal(this.app, this.plugin, semesterId, cls, () => {
            this.plugin.save();
            this.render();
          }).open();
        }));
      }
      menu.addSeparator();
      menu.addItem(item => item.setTitle('Delete class').setIcon('trash-2').onClick(() => {
        new DeleteClassModal(this.app, this.plugin, semesterId, cls, () => {
          this.plugin.save();
          this.navigate('dashboard');
        }).open();
      }));
      menu.showAtMouseEvent(e);
    });

    // Class name
    const nameRow = body.createDiv('hc-class-name-row');
    nameRow.createSpan({ cls: 'hc-class-name', text: cls.name });
    if (cls.courseUrl) {
      const urlBtn = nameRow.createEl('a', { cls: 'hc-class-url-btn', href: cls.courseUrl });
      urlBtn.setAttribute('target', '_blank');
      urlBtn.setAttribute('rel', 'noopener noreferrer');
      const urlIcon = urlBtn.createSpan({ cls: 'hc-inline-icon' });
      setIcon(urlIcon, 'external-link');
      urlBtn.addEventListener('click', e => e.stopPropagation());
    }

    // Professor
    if (cls.professorName) {
      const prof = body.createDiv('hc-class-prof');
      const icon = prof.createSpan({ cls: 'hc-inline-icon' });
      setIcon(icon, 'user');
      prof.createSpan({ text: cls.professorName });
    }

    // Meeting days (+ time, when set — same row, no extra height)
    if (cls.meetingDays?.length) {
      const daysRow = body.createDiv('hc-class-days');
      for (const day of cls.meetingDays) {
        daysRow.createSpan({ cls: 'hc-day-chip', text: day });
      }
      if (cls.meetingStartTime && cls.meetingEndTime) {
        daysRow.createSpan({ cls: 'hc-class-days-time', text: formatTimeRange(cls.meetingStartTime, cls.meetingEndTime) });
      }
    }

    // Location + date range — only when at least one is set. Matters most
    // for partial-term classes and a mix of in-person/online classes, where
    // "is this the one I drive to, and is it even running right now" is a
    // daily-glance fact, not just term-level trivia.
    if (cls.location || (cls.startDate && cls.endDate)) {
      const scheduleRow = body.createDiv('hc-class-schedule-row');
      if (cls.location) {
        const loc = scheduleRow.createDiv('hc-class-schedule-item');
        const locIcon = loc.createSpan({ cls: 'hc-inline-icon' });
        setIcon(locIcon, 'map-pin');
        loc.createSpan({ text: cls.location });
      }
      if (cls.startDate && cls.endDate) {
        const dates = scheduleRow.createDiv('hc-class-schedule-item');
        const dateIcon = dates.createSpan({ cls: 'hc-inline-icon' });
        setIcon(dateIcon, 'calendar');
        dates.createSpan({ text: `${formatDate(cls.startDate)} – ${formatDate(cls.endDate)}` });
      }
    }

    body.createDiv('hc-class-divider');

    // Next assignment
    if (next) {
      const info = getDueInfo(next.dueDate);
      body.createDiv({ cls: 'hc-class-next-label', text: 'Next assignment due' });
      body.createDiv({ cls: 'hc-class-next-title', text: next.title });
      if (info) {
        const dueEl = body.createDiv({ cls: 'hc-class-next-due', text: info.label });
        dueEl.style.color = info.color;
      }
    } else {
      body.createDiv({ cls: 'hc-class-next-label', text: 'No assignments due' });
      body.createDiv({ cls: 'hc-class-next-title', text: '—' });
    }

    // Lecture progress — only shown once at least one lecture is marked done
    const totalLectures = (cls.lectures || []).length;
    const doneLectures  = (cls.lectures || []).filter(l => l.status === 'done').length;
    if (totalLectures > 0 && doneLectures > 0) {
      body.createDiv('hc-class-divider');
      const progRow = body.createDiv('hc-class-lec-progress');
      const icon = progRow.createSpan({ cls: 'hc-inline-icon' });
      setIcon(icon, 'book-open');
      icon.style.color = accentText(color);
      progRow.createSpan({ cls: 'hc-class-lec-progress-text', text: `${doneLectures} / ${totalLectures} lectures` });
    }

    card.addEventListener('click', () => this.navigate('class', cls.id));
  }

  // ─── Class view ───────────────────────────────────────────────────────────

  _renderClassView(content) {
    const sem = this._getViewedSemester();
    if (!sem) { this.navigate('dashboard'); return; }
    const cls = sem.classes.find(c => c.id === this.currentClassId);
    if (!cls) { this.navigate('dashboard'); return; }

    const color = getColor(cls.colorIndex);

    // Class header
    const header = content.createDiv('hc-class-header');

    const codeRow = header.createDiv('hc-class-header-code-row');
    const accent = codeRow.createDiv('hc-class-header-accent');
    accent.style.background = color.accent;
    const codeEl = codeRow.createSpan({ cls: 'hc-class-header-code', text: cls.code });
    codeEl.style.color = accentText(color);

    const editBtn = codeRow.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const editIcon = editBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(editIcon, 'pencil');
    editBtn.createSpan({ text: 'Edit' });
    editBtn.addEventListener('click', () => {
      new EditClassModal(this.app, this.plugin, sem.id, cls, () => {
        this.plugin.save();
        this.render();
      }).open();
    });

    const nameRow = header.createDiv('hc-class-header-name');
    nameRow.createSpan({ cls: 'hc-class-header-name-text', text: cls.name });
    // Renders only for completed / dropped. Ongoing is the quiet common case;
    // unset has nothing to say.
    const clsStatus = cls.status || null;
    if (clsStatus === 'completed' || clsStatus === 'dropped') {
      nameRow.createSpan({
        cls: 'hc-class-status-tag',
        text: classStatusLabel(clsStatus).toUpperCase(),
      });
    }

    // Logistics row — when and how class happens
    const meta = header.createDiv('hc-class-header-meta');

    if (cls.meetingDays?.length) {
      const item = meta.createDiv('hc-class-meta-item');
      const icon = item.createSpan({ cls: 'hc-inline-icon' });
      setIcon(icon, 'clock');
      icon.style.color = accentText(color);
      let clockText = cls.meetingDays.join(' · ');
      if (cls.meetingStartTime && cls.meetingEndTime) {
        clockText += ' · ' + formatTimeRange(cls.meetingStartTime, cls.meetingEndTime);
      }
      item.createSpan({ text: clockText });
    }

    if (cls.location) {
      const item = meta.createDiv('hc-class-meta-item');
      const icon = item.createSpan({ cls: 'hc-inline-icon' });
      setIcon(icon, 'map-pin');
      icon.style.color = accentText(color);
      item.createSpan({ text: cls.location });
    }

    if (cls.meetingLink) {
      const item = meta.createDiv('hc-class-meta-item');
      const icon = item.createSpan({ cls: 'hc-inline-icon' });
      setIcon(icon, 'video');
      icon.style.color = accentText(color);
      const link = item.createEl('a', { text: 'Meeting link', href: cls.meetingLink });
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.style.color = accentText(color);
    }

    if (cls.courseUrl) {
      const item = meta.createDiv('hc-class-meta-item');
      const icon = item.createSpan({ cls: 'hc-inline-icon' });
      setIcon(icon, 'external-link');
      icon.style.color = accentText(color);
      const link = item.createEl('a', { text: 'Course page', href: cls.courseUrl });
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.style.color = accentText(color);
    }

    if (!meta.hasChildNodes()) meta.remove();

    // People row — professor and TA, equal weight
    this._renderPeopleRow(header, cls, color);

    // Tab row — functional
    const tabRow = content.createDiv('hc-tab-row');
    // #9: Readings split out of Assignments — a reading is prep tied to a
    // lecture, not graded work, and mixing the two made the Assignments tab
    // read like a to-do list instead of "what's due and graded." (LiveAQuietLife, 2026-09-01)
    const tabs = ['Lectures', 'Assignments', 'Readings', 'Exams', 'Library'];
    for (const tab of tabs) {
      const btn = tabRow.createEl('button', { cls: 'hc-tab', text: tab });
      if (tab === this.currentTab) {
        btn.addClass('hc-tab--active');
        btn.style.color = accentText(color);
        btn.style.borderBottomColor = accentText(color);
      }
      btn.addEventListener('click', () => this.navigateTab(tab));
    }

    if (this.currentTab === 'Lectures') {
      this._renderLectureList(content, sem, cls, color);
    } else if (this.currentTab === 'Assignments') {
      this._renderAssignmentList(content, sem, cls, color);
    } else if (this.currentTab === 'Readings') {
      this._renderReadingsList(content, sem, cls, color);
    } else if (this.currentTab === 'Exams') {
      this._renderExamList(content, sem, cls, color);
    } else if (this.currentTab === 'Library') {
      this._renderLibraryList(content, sem, cls, color);
    }
  }

  _renderPeopleRow(header, cls, color) {
    const hasProf = !!(cls.professorName || cls.professorEmail || cls.officeHours);
    const hasTa = !!(cls.taName || cls.taEmail || cls.taOfficeHours);
    if (!hasProf && !hasTa) return;

    const row = header.createDiv('hc-class-people-row');
    if (hasProf) {
      this._renderPersonBlock(row, 'Professor', cls.professorName, cls.professorEmail, cls.officeHours, color);
    }
    if (hasTa) {
      this._renderPersonBlock(row, 'TA', cls.taName, cls.taEmail, cls.taOfficeHours, color);
    }
  }

  _renderPersonBlock(row, label, name, email, officeHours, color) {
    const block = row.createDiv('hc-class-person');
    block.createDiv({ cls: 'hc-class-person-label', text: label });
    const items = block.createDiv('hc-class-person-items');

    if (name) {
      const item = items.createDiv('hc-class-meta-item');
      const icon = item.createSpan({ cls: 'hc-inline-icon' });
      setIcon(icon, 'user');
      icon.style.color = accentText(color);
      item.createSpan({ text: name });
    }

    if (email) {
      const item = items.createDiv('hc-class-meta-item');
      const icon = item.createSpan({ cls: 'hc-inline-icon' });
      setIcon(icon, 'mail');
      icon.style.color = accentText(color);
      const link = item.createEl('a', { text: email, href: `mailto:${email}` });
      link.style.color = accentText(color);
    }

    if (officeHours) {
      const item = items.createDiv('hc-class-meta-item');
      const icon = item.createSpan({ cls: 'hc-inline-icon' });
      setIcon(icon, 'door-open');
      icon.style.color = accentText(color);
      item.createSpan({ text: officeHours });
    }
  }

  _renderLectureList(content, sem, cls, color) {
    if (cls.lectureShowDone === undefined) cls.lectureShowDone = true;
    const showDone = cls.lectureShowDone;
    const sortDesc = cls.lectureSort === 'desc';
    const sorted = getLecturesSorted(cls);
    const displayed = (sortDesc ? [...sorted].reverse() : sorted)
      .filter(lec => showDone || lec.status !== 'done');

    const controlRow = content.createDiv('hc-lecture-controls');

    const leftControls = controlRow.createDiv('hc-lecture-left-controls');

    const sortBtn = leftControls.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const sortIcon = sortBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(sortIcon, sortDesc ? 'arrow-down-narrow-wide' : 'arrow-up-narrow-wide');
    sortBtn.createSpan({ text: sortDesc ? 'Newest first' : 'Oldest first' });
    sortBtn.addEventListener('click', () => {
      cls.lectureSort = sortDesc ? 'asc' : 'desc';
      this.plugin.save();
      this.render();
    });

    const doneToggle = leftControls.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const doneIcon = doneToggle.createSpan({ cls: 'hc-btn-icon' });
    setIcon(doneIcon, showDone ? 'eye-off' : 'eye');
    doneToggle.createSpan({ text: showDone ? 'Hide done' : 'Show done' });
    doneToggle.addEventListener('click', () => {
      cls.lectureShowDone = !cls.lectureShowDone;
      this.plugin.save();
      this.render();
    });

    const rightControls = controlRow.createDiv('hc-lecture-controls-right');

    const bulkBtn = rightControls.createEl('button', { cls: 'hc-btn' });
    const bulkIcon = bulkBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(bulkIcon, 'list-plus');
    bulkBtn.createSpan({ text: 'Bulk add' });
    bulkBtn.addEventListener('click', () => {
      new BulkAddLecturesModal(this.app, this.plugin, sem.id, cls.id, () => {
        this.plugin.save();
        this.render();
      }).open();
    });

    const addBtn = rightControls.createEl('button', { cls: 'hc-btn' });
    const addIcon = addBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(addIcon, 'plus');
    addBtn.createSpan({ text: 'Add lecture' });
    addBtn.addEventListener('click', () => {
      new AddLectureModal(this.app, this.plugin, sem.id, cls.id, () => {
        this.plugin.save();
        this.render();
      }).open();
    });

    // Lecture list
    const list = content.createDiv('hc-lecture-list');

    if (sorted.length === 0) {
      const empty = list.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'No lectures yet. Add your first one above.' });
    } else if (displayed.length === 0) {
      const empty = list.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'All lectures marked done.' });
    } else {
      for (const lec of displayed) {
        const chronNum = sorted.indexOf(lec) + 1;
        this._renderLectureRow(list, lec, chronNum, color, sem, cls);
      }
    }
  }

  _renderLectureRow(list, lec, num, color, sem, cls) {
    const row = list.createDiv('hc-lecture-row');
    if (lec.status === 'done') row.addClass('hc-lecture-row--done');

    // Number badge
    const badge = row.createDiv('hc-lecture-badge');
    badge.setText(String(num));
    badge.style.background = color.bg;
    badge.style.color = color.accent;

    // Title + date
    const info = row.createDiv('hc-lecture-info');
    info.createDiv({ cls: 'hc-lecture-title', text: lec.title });
    if (lec.date) {
      info.createDiv({ cls: 'hc-lecture-date', text: formatDateWithDay(lec.date) });
    }

    // Status + chevron
    const right = row.createDiv('hc-lecture-right');

    // Linked-note flag. Silent when absent — no placeholder, no greyed state.
    // Reads lec.vaultLink (the Browse/Open note/Remove field on the lecture
    // detail), not lec.notes (the Key Concepts textarea).
    if ((lec.vaultLink || '').trim()) {
      right.createDiv({ cls: 'hc-lecture-note-flag', text: 'Linked note' });
    }

    // #9: broken out by Reading vs. everything else — "2 assignments" was
    // misleading when a lecture's items were actually readings; the Lectures
    // tab overview should match what the Readings/Assignments split means
    // everywhere else now. (LiveAQuietLife, 2026-09-01)
    const lecItems = lec.assignments || [];
    const lecReadingCount = lecItems.filter(a => a.type === 'Reading').length;
    const lecOtherCount = lecItems.length - lecReadingCount;
    const countParts = [];
    if (lecReadingCount > 0) countParts.push(`${lecReadingCount} ${lecReadingCount === 1 ? 'reading' : 'readings'}`);
    if (lecOtherCount > 0) countParts.push(`${lecOtherCount} ${lecOtherCount === 1 ? 'assignment' : 'assignments'}`);
    if (countParts.length > 0) {
      right.createDiv({ cls: 'hc-lecture-assign-count', text: countParts.join(', ') });
    }

    const statusEl = right.createDiv({ cls: `hc-lecture-status hc-lecture-status--${lec.status} hc-status-clickable` });
    statusEl.setText(statusLabel(lec.status));
    statusEl.setAttribute('aria-label', 'Click to change status');
    statusEl.addEventListener('click', (e) => {
      e.stopPropagation();
      lec.status = cycleStatus(lec.status);
      this.plugin.save();
      this.render();
    });

    const chev = right.createDiv('hc-lecture-chevron');
    setIcon(chev, 'chevron-right');

    row.addEventListener('click', () => this.navigate('lecture', cls.id, lec.id));
  }

  // ─── Lecture detail ───────────────────────────────────────────────────────

  _renderLectureDetail(content) {
    const sem = this._getViewedSemester();
    if (!sem) { this.navigate('dashboard'); return; }
    const cls = sem.classes.find(c => c.id === this.currentClassId);
    if (!cls) { this.navigate('dashboard'); return; }
    const lec = cls.lectures.find(l => l.id === this.currentLectureId);
    if (!lec) { this.navigate('class', cls.id); return; }

    const color = getColor(cls.colorIndex);
    const sorted = getLecturesSorted(cls);
    const num = sorted.indexOf(lec) + 1;

    // Top bar: back button + prev/next nav
    const topbar = content.createDiv('hc-detail-topbar');
    const backBtn = topbar.createEl('button', { cls: 'hc-btn hc-lecture-back-btn' });
    const backIcon = backBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(backIcon, 'arrow-left');
    backBtn.createSpan({ text: cls.code });
    backBtn.addEventListener('click', () => this.navigate('class', cls.id));

    const navEl = topbar.createDiv('hc-detail-nav');
    const idx = sorted.indexOf(lec);
    const prevLec = sorted[idx - 1] || null;
    const nextLec = sorted[idx + 1] || null;
    const prevLecBtn = navEl.createEl('button', { cls: 'hc-detail-nav-btn' });
    setIcon(prevLecBtn, 'chevron-left');
    prevLecBtn.disabled = !prevLec;
    prevLecBtn.addEventListener('click', () => {
      if (prevLec) this.navigate('lecture', cls.id, prevLec.id);
    });
    navEl.createSpan({ cls: 'hc-detail-nav-pos', text: `${idx + 1} / ${sorted.length}` });
    const nextLecBtn = navEl.createEl('button', { cls: 'hc-detail-nav-btn' });
    setIcon(nextLecBtn, 'chevron-right');
    nextLecBtn.disabled = !nextLec;
    nextLecBtn.addEventListener('click', () => {
      if (nextLec) this.navigate('lecture', cls.id, nextLec.id);
    });

    // Lecture label
    const labelEl = content.createDiv('hc-lecture-detail-label');
    labelEl.setText(`Lecture ${num}`);
    labelEl.style.color = accentText(color);

    // Title
    content.createDiv({ cls: 'hc-lecture-detail-title', text: lec.title });

    // Date
    if (lec.date) {
      content.createDiv({ cls: 'hc-lecture-detail-date', text: formatDateLong(lec.date) });
    }

    // Status + actions row
    const actionsRow = content.createDiv('hc-lecture-detail-actions');

    const statusBtn = actionsRow.createEl('button', { cls: `hc-lecture-status-btn hc-lecture-status-btn--${lec.status}` });
    statusBtn.setText(statusLabel(lec.status));
    statusBtn.addEventListener('click', () => {
      lec.status = cycleStatus(lec.status);
      this.plugin.save();
      this.render();
    });

    const editBtn = actionsRow.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const editIcon = editBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(editIcon, 'pencil');
    editBtn.createSpan({ text: 'Edit' });
    editBtn.addEventListener('click', () => {
      new EditLectureModal(this.app, this.plugin, sem.id, cls.id, lec, () => {
        this.plugin.save();
        this.render();
      }).open();
    });

    const deleteBtn = actionsRow.createEl('button', { cls: 'hc-btn hc-btn--sm hc-btn--danger' });
    const deleteIcon = deleteBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(deleteIcon, 'trash-2');
    deleteBtn.createSpan({ text: 'Delete' });
    deleteBtn.addEventListener('click', () => {
      new DeleteLectureModal(this.app, this.plugin, sem.id, cls.id, lec, () => {
        this.plugin.save();
        this.navigate('class', cls.id);
      }).open();
    });

    // Notes section
    content.createDiv({ cls: 'hc-lecture-section-label', text: 'Key Concepts & Lesson Goal' });
    const textarea = content.createEl('textarea', { cls: 'hc-lecture-notes' });
    textarea.value = lec.notes || '';
    textarea.placeholder = 'Add notes, key concepts, or lesson goals…';
    textarea.addEventListener('blur', () => {
      lec.notes = textarea.value;
      this.plugin.save();
    });

    // Vault link section
    content.createDiv({ cls: 'hc-lecture-section-label', text: 'Lecture Notes' });
    const vaultLinkSection = content.createDiv('hc-assign-note-section');

    const renderVaultLinkSection = () => {
      vaultLinkSection.empty();
      const path = lec.vaultLink || '';

      const linkRow = vaultLinkSection.createDiv('hc-assign-note-row');
      const textWrap = linkRow.createDiv('hc-assign-note-input-wrap');

      if (path) {
        // #8: once a note is linked, show the friendly filename as
        // read-only text instead of an editable input. This field's value
        // used to be saved directly from whatever text sat in the box on
        // blur — showing just the filename there would let an unrelated
        // edit silently overwrite the real path with a folder-less
        // fragment, breaking the link. Browse/Remove are now the only way
        // to change an existing link, matching how the Resource detail
        // page's vault link already behaves. (LiveAQuietLife/Claude, 2026-08-30)
        textWrap.createDiv({ cls: 'hc-assign-link-display', text: path.split('/').pop() });
      } else {
        const linkInput = textWrap.createEl('input', { cls: 'hc-assign-link-input', type: 'text' });
        linkInput.placeholder = 'path/to/notes.md';
        linkInput.value = path;
        linkInput.addEventListener('blur', () => {
          lec.vaultLink = linkInput.value.trim();
          this.plugin.save();
          renderVaultLinkSection();
        });
      }

      const browseBtn = linkRow.createEl('button', { cls: 'hc-btn hc-btn--sm', text: 'Browse' });
      browseBtn.addEventListener('click', () => {
        new VaultLinkSuggestModal(this.app, (selectedPath) => {
          lec.vaultLink = selectedPath;
          this.plugin.save();
          renderVaultLinkSection();
        }).open();
      });

      if (path) {
        const openBtn = linkRow.createEl('button', { cls: 'hc-btn hc-btn--sm', text: 'Open note' });
        openBtn.addEventListener('click', () => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file) this.app.workspace.openLinkText(path, '', false);
          else new Notice('Note not found in vault.');
        });

        const removeBtn = linkRow.createEl('button', { cls: 'hc-btn hc-btn--sm', text: 'Remove' });
        removeBtn.addEventListener('click', () => {
          lec.vaultLink = '';
          this.plugin.save();
          renderVaultLinkSection();
        });
      }
    };
    renderVaultLinkSection();

    // #9: split into Readings and Assignments, mirroring the class-level
    // tabs — "Assignments" here used to mean "everything for this lecture,"
    // which no longer matches what "Assignments" means on the class tab
    // (not readings). Both groups render with the same row treatment as
    // before; only the grouping and labels changed. Both show an explicit
    // empty state rather than disappearing, so the structure is visible
    // even before anything's been added. (LiveAQuietLife, 2026-09-01)
    const lecAssignments = lec.assignments || [];

    content.createDiv({ cls: 'hc-lecture-section-label', text: 'Readings' });
    const readingList = content.createDiv('hc-lecture-assign-list');
    this._renderLectureAssignRows(
      readingList,
      lecAssignments.filter(a => a.type === 'Reading'),
      cls, lec,
      'No readings for this lecture.'
    );

    // Assignments section
    content.createDiv({ cls: 'hc-lecture-section-label', text: 'Assignments' });
    const assignList = content.createDiv('hc-lecture-assign-list');
    this._renderLectureAssignRows(
      assignList,
      lecAssignments.filter(a => a.type !== 'Reading'),
      cls, lec,
      'No assignments for this lecture.'
    );

    const assignActions = content.createDiv('hc-lecture-assign-actions');

    const addAssignBtn = assignActions.createEl('button', { cls: 'hc-btn' });
    const addAssignIcon = addAssignBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(addAssignIcon, 'plus');
    addAssignBtn.createSpan({ text: 'Add assignment' });
    addAssignBtn.addEventListener('click', () => {
      new AddAssignmentModal(this.app, this.plugin, sem.id, cls, () => {
        this.plugin.save();
        this.render();
      }, lec.id).open();
    });

    const bulkAssignBtn = assignActions.createEl('button', { cls: 'hc-btn' });
    const bulkAssignIcon = bulkAssignBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(bulkAssignIcon, 'list-plus');
    bulkAssignBtn.createSpan({ text: 'Bulk add' });
    bulkAssignBtn.addEventListener('click', () => {
      new BulkAddAssignmentsModal(this.app, this.plugin, sem.id, cls.id, lec.id, () => {
        this.plugin.save();
        this.render();
      }).open();
    });
  }

  // Row rendering for one of the two lecture-detail groups (Readings /
  // Assignments) — pulled out of _renderLectureDetail so both groups share
  // exactly the same row markup and empty-state handling. #9 (LiveAQuietLife, 2026-09-01)
  _renderLectureAssignRows(container, items, cls, lec, emptyText) {
    if (items.length === 0) {
      container.createDiv({ cls: 'hc-empty-text hc-lecture-assign-empty', text: emptyText });
      return;
    }
    for (const a of items) {
      const aRow = container.createDiv('hc-lecture-assign-row hc-lecture-assign-row--clickable');
      aRow.addEventListener('click', () => this.navigate('assignment', cls.id, lec.id, a.id));
      if (a.type) {
        aRow.createSpan({ cls: 'hc-assign-type-pill', text: a.type });
      }
      const aInfo = aRow.createDiv('hc-lecture-assign-info');
      aInfo.createDiv({ cls: 'hc-lecture-assign-title', text: a.title });
      if (a.status) aInfo.createDiv({ cls: 'hc-lecture-assign-status', text: a.status });
      if (a.dueDate) {
        const info = getDueInfo(a.dueDate);
        const dueEl = aRow.createDiv('hc-lecture-assign-due');
        dueEl.createDiv({ cls: 'hc-lecture-assign-due-label', text: 'Due' });
        const dueDate = dueEl.createDiv({ cls: 'hc-lecture-assign-due-date', text: formatDate(a.dueDate) });
        if ((info?.urgency === 'overdue' || info?.urgency === 'today') && a.status !== 'done') {
          dueDate.style.color = '#E24B4A';
          if (info.urgency === 'overdue') {
            dueEl.createDiv({ cls: 'hc-lecture-assign-overdue', text: 'Overdue' });
          }
        }
      }
    }
  }

  // ─── Assignment list ──────────────────────────────────────────────────────

  _renderAssignmentList(content, sem, cls, color) {
    if (cls.assignShowDone === undefined) cls.assignShowDone = true;
    const showDone = cls.assignShowDone;

    // Collect all assignments with lecture context.
    // #9: Reading-type items are excluded here — they live in the Readings
    // tab now, not mixed in with graded/deadline work. (LiveAQuietLife, 2026-09-01)
    const items = [];
    for (const a of (cls.assignments || [])) {
      if (a.type === 'Reading') continue;
      items.push({ assignment: a, lectureLabel: null });
    }
    const sorted = getLecturesSorted(cls);
    sorted.forEach((lec, i) => {
      for (const a of (lec.assignments || [])) {
        if (a.type === 'Reading') continue;
        items.push({ assignment: a, lectureLabel: `L${i + 1} — ${lec.title}` });
      }
    });

    // Sort by due date
    items.sort((a, b) => {
      if (!a.assignment.dueDate && !b.assignment.dueDate) return 0;
      if (!a.assignment.dueDate) return 1;
      if (!b.assignment.dueDate) return -1;
      return a.assignment.dueDate.localeCompare(b.assignment.dueDate);
    });

    // Fixed type list for filter dropdown (matches ASSIGNMENT_TYPES).
    // #9: Reading dropped — nothing in this list is ever type Reading anymore. (LiveAQuietLife, 2026-09-01)
    const presentTypes = ASSIGNMENT_TYPES.filter(t => t !== 'Reading');

    // Apply filters
    let displayed = showDone ? items : items.filter(i => i.assignment.status !== 'done');
    if (this.classAssignFilterType) {
      displayed = displayed.filter(i => (i.assignment.type || 'Other') === this.classAssignFilterType);
    }

    const controlRow = content.createDiv('hc-assign-controls');

    // Hide done toggle
    const doneToggle = controlRow.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const doneIcon = doneToggle.createSpan({ cls: 'hc-btn-icon' });
    setIcon(doneIcon, showDone ? 'eye-off' : 'eye');
    doneToggle.createSpan({ text: showDone ? 'Hide done' : 'Show done' });
    doneToggle.addEventListener('click', () => {
      cls.assignShowDone = !cls.assignShowDone;
      this.plugin.save();
      this.render();
    });

    // Type filter dropdown
    const typeFilterWrap = controlRow.createDiv('hc-cal-filter-wrap');
    const typeFilterBtn = typeFilterWrap.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const typeFilterIcon = typeFilterBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(typeFilterIcon, 'filter');
    typeFilterBtn.createSpan({ cls: 'hc-global-filter-label', text: this.classAssignFilterType || 'All types' });
    const typeChevron = typeFilterBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(typeChevron, 'chevron-down');

    let typeDropEl = null;
    const closeTypeDrop = () => { if (typeDropEl) { typeDropEl.remove(); typeDropEl = null; } };

    typeFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeDropEl) { closeTypeDrop(); return; }
      typeDropEl = typeFilterWrap.createDiv('hc-sem-drop hc-cal-filter-drop');

      const allItem = typeDropEl.createDiv('hc-sem-drop-item');
      if (!this.classAssignFilterType) allItem.addClass('hc-sem-drop-item--active');
      const allIcon = allItem.createSpan({ cls: 'hc-sem-drop-icon' });
      if (!this.classAssignFilterType) setIcon(allIcon, 'check');
      allItem.createSpan({ text: 'All types' });
      allItem.addEventListener('click', () => { this.classAssignFilterType = null; closeTypeDrop(); this.render(); });

      typeDropEl.createDiv('hc-sem-drop-divider');

      for (const type of presentTypes) {
        const item = typeDropEl.createDiv('hc-sem-drop-item');
        if (type === this.classAssignFilterType) item.addClass('hc-sem-drop-item--active');
        const icon = item.createSpan({ cls: 'hc-sem-drop-icon' });
        if (type === this.classAssignFilterType) setIcon(icon, 'check');
        const style = getTypeStyle(type);
        const lbl = item.createSpan({ text: type });
        lbl.style.color = typeText(style);
        item.addEventListener('click', () => { this.classAssignFilterType = type; closeTypeDrop(); this.render(); });
      }

      setTimeout(() => document.addEventListener('click', () => closeTypeDrop(), { once: true }), 0);
    });

    // Add assignment button
    const addBtn = controlRow.createEl('button', { cls: 'hc-btn' });
    const addIcon = addBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(addIcon, 'plus');
    addBtn.createSpan({ text: 'Add assignment' });
    addBtn.addEventListener('click', () => {
      // #9: Reading dropped from the Type choices here — this button is
      // scoped to the Assignments tab, and Reading has its own tab and its
      // own button now. (LiveAQuietLife, 2026-09-01)
      new AddAssignmentModal(this.app, this.plugin, sem.id, cls, () => {
        this.plugin.save();
        this.render();
      }, null, 'Writing', null, ['Reading']).open();
    });

    const list = content.createDiv('hc-assign-list');

    if (items.length === 0) {
      const empty = list.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'No assignments yet.' });
    } else if (displayed.length === 0) {
      const empty = list.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: this.classAssignFilterType ? `No ${this.classAssignFilterType} assignments.` : 'All assignments done.' });
    } else {
      for (const { assignment, lectureLabel } of displayed) {
        this._renderAssignmentRow(list, assignment, lectureLabel, sem, cls);
      }
    }
  }

  _renderAssignmentRow(container, assignment, lectureLabel, sem, cls) {
    const typeStyle = getTypeStyle(assignment.type);
    const info = assignment.dueDate ? getDueInfo(assignment.dueDate) : null;

    const row = container.createDiv('hc-assign-row');
    if (assignment.status === 'done') row.addClass('hc-assign-row--done');
    if (assignment.type === 'Writing') row.addClass('hc-assign-row--writing');

    // Left: type pill
    const pill = row.createSpan({ cls: 'hc-assign-pill', text: assignment.type || 'Other' });
    pill.style.color = typeStyle.color;
    pill.style.background = typeStyle.bg;

    // Middle: title, lecture, grade (once done)
    const mid = row.createDiv('hc-assign-mid');
    mid.createDiv({ cls: 'hc-assign-title', text: assignment.title });
    mid.createDiv({
      cls: 'hc-assign-lecture',
      text: lectureLabel ? lectureLabel : 'Class-level',
    });
    if (assignment.status === 'done' && (assignment.grade || '').trim()) {
      mid.createSpan({ cls: 'hc-grade-chip', text: assignment.grade.trim() });
    }

    // Right: status (matches the lecture/exam position), then due date
    const right = row.createDiv('hc-assign-due');
    const isDone = assignment.status === 'done';

    const statusEl = right.createDiv({ cls: `hc-assign-status hc-assign-status--${assignment.status} hc-status-clickable` });
    statusEl.setText(statusLabel(assignment.status));
    statusEl.setAttribute('aria-label', 'Click to change status');
    statusEl.addEventListener('click', (e) => {
      e.stopPropagation();
      assignment.status = cycleStatus(assignment.status);
      this.plugin.save();
      this.render();
    });

    if (info) {
      right.createDiv({ cls: 'hc-assign-due-label', text: 'Due' });
      const dateEl = right.createDiv({ cls: 'hc-assign-due-date', text: formatDate(assignment.dueDate) });
      if (!isDone) {
        dateEl.style.color = info.color;
        if (info.urgency === 'overdue') {
          right.createDiv({ cls: 'hc-assign-due-note', text: 'Overdue' }).style.color = info.color;
        } else if (info.urgency !== 'upcoming') {
          right.createDiv({ cls: 'hc-assign-due-note', text: info.note }).style.color = info.color;
        } else {
          right.createDiv({ cls: 'hc-assign-due-note', text: info.note });
        }
      }
    }

    row.addEventListener('click', () => this.navigate('assignment', cls.id, null, assignment.id));
  }

  // ─── Readings list ───────────────────────────────────────────────────────
  // #9: split out of Assignments — a reading is prep tied to a lecture
  // ("have it done before Thursday"), not graded/deadline work, and the two
  // don't read as the same kind of item in one list. Same underlying
  // assignment records (type: 'Reading'), just a dedicated view. Grade never
  // applied here, so no field for it to begin with. (LiveAQuietLife, 2026-09-01)

  _renderReadingsList(content, sem, cls, color) {
    if (cls.readingsShowDone === undefined) cls.readingsShowDone = true;
    const showDone = cls.readingsShowDone;

    const items = [];
    for (const a of (cls.assignments || [])) {
      if (a.type !== 'Reading') continue;
      items.push({ assignment: a, lectureLabel: null });
    }
    const sorted = getLecturesSorted(cls);
    sorted.forEach((lec, i) => {
      for (const a of (lec.assignments || [])) {
        if (a.type !== 'Reading') continue;
        items.push({ assignment: a, lectureLabel: `Before Lecture ${i + 1} — ${lec.title}` });
      }
    });

    // Sort by due date — same ordering as the Assignments list, so a
    // reading's place in the list still tracks when it's actually due.
    items.sort((a, b) => {
      if (!a.assignment.dueDate && !b.assignment.dueDate) return 0;
      if (!a.assignment.dueDate) return 1;
      if (!b.assignment.dueDate) return -1;
      return a.assignment.dueDate.localeCompare(b.assignment.dueDate);
    });

    const displayed = showDone ? items : items.filter(i => i.assignment.status !== 'done');

    const controlRow = content.createDiv('hc-assign-controls');

    const doneToggle = controlRow.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const doneIcon = doneToggle.createSpan({ cls: 'hc-btn-icon' });
    setIcon(doneIcon, showDone ? 'eye-off' : 'eye');
    doneToggle.createSpan({ text: showDone ? 'Hide done' : 'Show done' });
    doneToggle.addEventListener('click', () => {
      cls.readingsShowDone = !cls.readingsShowDone;
      this.plugin.save();
      this.render();
    });

    const addBtn = controlRow.createEl('button', { cls: 'hc-btn' });
    const addIcon = addBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(addIcon, 'plus');
    addBtn.createSpan({ text: 'Add reading' });
    addBtn.addEventListener('click', () => {
      // #9: locked to Reading — this button is scoped to the Readings tab,
      // so there's no Type choice to offer. (LiveAQuietLife, 2026-09-01)
      new AddAssignmentModal(this.app, this.plugin, sem.id, cls, () => {
        this.plugin.save();
        this.render();
      }, null, 'Reading', 'Reading').open();
    });

    const list = content.createDiv('hc-reading-list');

    if (items.length === 0) {
      const empty = list.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'No readings yet.' });
    } else if (displayed.length === 0) {
      const empty = list.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'All readings done.' });
    } else {
      for (const { assignment, lectureLabel } of displayed) {
        this._renderReadingRow(list, assignment, lectureLabel, sem, cls);
      }
    }
  }

  _renderReadingRow(container, assignment, lectureLabel, sem, cls) {
    const info = assignment.dueDate ? getDueInfo(assignment.dueDate) : null;
    const linkedResource = assignment.linkedBook
      ? (sem.resources || []).find(r => r.id === assignment.linkedBook)
      : null;

    const row = container.createDiv('hc-reading-row');
    if (assignment.status === 'done') row.addClass('hc-reading-row--done');

    const iconWrap = row.createDiv('hc-reading-icon');
    setIcon(iconWrap, 'book-open');

    const mid = row.createDiv('hc-reading-mid');
    mid.createDiv({ cls: 'hc-reading-title', text: assignment.title });
    mid.createDiv({ cls: 'hc-reading-context', text: lectureLabel || 'Class-level' });

    const bookLine = mid.createDiv('hc-reading-book');
    if (linkedResource) {
      bookLine.setText(linkedResource.author ? `${linkedResource.title} — ${linkedResource.author}` : linkedResource.title);
    } else {
      bookLine.addClass('hc-reading-book--orphan');
      bookLine.setText(assignment.linkedBook ? 'Book not found in Library' : 'No linked book');
    }

    // Linked-note flag — same silent-when-absent treatment as the Lectures
    // tab's own vaultLink flag: nothing rendered when there's no linked
    // note, a quiet label when there is. #9 (LiveAQuietLife, 2026-09-01)
    if ((assignment.linkedNote || '').trim()) {
      mid.createDiv({ cls: 'hc-lecture-note-flag', text: 'Linked note' });
    }

    // Right: status + due date — identical pattern to the Assignments row,
    // just without the type pill or grade chip (neither applies to Reading).
    const right = row.createDiv('hc-assign-due');
    const isDone = assignment.status === 'done';

    const statusEl = right.createDiv({ cls: `hc-assign-status hc-assign-status--${assignment.status} hc-status-clickable` });
    statusEl.setText(statusLabel(assignment.status));
    statusEl.setAttribute('aria-label', 'Click to change status');
    statusEl.addEventListener('click', (e) => {
      e.stopPropagation();
      assignment.status = cycleStatus(assignment.status);
      this.plugin.save();
      this.render();
    });

    if (info) {
      right.createDiv({ cls: 'hc-assign-due-label', text: 'Due' });
      const dateEl = right.createDiv({ cls: 'hc-assign-due-date', text: formatDate(assignment.dueDate) });
      if (!isDone) {
        dateEl.style.color = info.color;
        if (info.urgency === 'overdue') {
          right.createDiv({ cls: 'hc-assign-due-note', text: 'Overdue' }).style.color = info.color;
        } else if (info.urgency !== 'upcoming') {
          right.createDiv({ cls: 'hc-assign-due-note', text: info.note }).style.color = info.color;
        } else {
          right.createDiv({ cls: 'hc-assign-due-note', text: info.note });
        }
      }
    }

    row.addEventListener('click', () => this.navigate('assignment', cls.id, null, assignment.id));
  }

  // ─── Assignment detail ────────────────────────────────────────────────────

  _renderAssignmentDetail(content) {
    const sem = this._getViewedSemester();
    if (!sem) { this.navigate('dashboard'); return; }
    const cls = sem.classes.find(c => c.id === this.currentClassId);
    if (!cls) { this.navigate('dashboard'); return; }
    const result = this.plugin.findAssignment(sem.id, cls.id, this.currentAssignmentId);
    if (!result) { this.currentTab = 'Assignments'; this.navigate('class', cls.id); return; }

    const { assignment, lectureId } = result;
    const color = getColor(cls.colorIndex);
    const typeStyle = getTypeStyle(assignment.type);

    // Top bar: back button + prev/next nav
    const assignSorted = getAssignmentsSorted(cls);
    const assignIdx = assignSorted.findIndex(item => item.assignment.id === assignment.id);
    const prevAssign = assignIdx > 0 ? assignSorted[assignIdx - 1] : null;
    const nextAssign = assignIdx < assignSorted.length - 1 ? assignSorted[assignIdx + 1] : null;

    const topbar = content.createDiv('hc-detail-topbar');
    const backBtn = topbar.createEl('button', { cls: 'hc-btn hc-lecture-back-btn' });
    const backIcon = backBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(backIcon, 'arrow-left');
    const fromGlobal = this.previousScreen === 'assignments';
    const fromLecture = this.previousScreen === 'lecture';
    if (fromGlobal) backBtn.createSpan({ text: 'All Assignments' });
    else if (fromLecture) {
      const srcLec = cls.lectures.find(l => l.id === this.currentLectureId);
      const srcSorted = getLecturesSorted(cls);
      const srcNum = srcLec ? srcSorted.indexOf(srcLec) + 1 : '?';
      backBtn.createSpan({ text: `Lecture ${srcNum}` });
    } else backBtn.createSpan({ text: cls.code });
    backBtn.addEventListener('click', () => {
      if (fromGlobal) {
        this.navigate('assignments');
      } else if (fromLecture) {
        this.navigate('lecture', cls.id, this.currentLectureId);
      } else {
        // #9: back to Readings for a Reading item, Assignments otherwise. (LiveAQuietLife, 2026-09-01)
        this.currentTab = assignment.type === 'Reading' ? 'Readings' : 'Assignments';
        this.navigate('class', cls.id);
      }
    });

    const assignNavEl = topbar.createDiv('hc-detail-nav');
    const prevAssignBtn = assignNavEl.createEl('button', { cls: 'hc-detail-nav-btn' });
    setIcon(prevAssignBtn, 'chevron-left');
    prevAssignBtn.disabled = !prevAssign;
    prevAssignBtn.addEventListener('click', () => {
      if (prevAssign) this.navigate('assignment', cls.id, prevAssign.lectureId, prevAssign.assignment.id);
    });
    assignNavEl.createSpan({ cls: 'hc-detail-nav-pos', text: assignIdx >= 0 ? `${assignIdx + 1} / ${assignSorted.length}` : '' });
    const nextAssignBtn = assignNavEl.createEl('button', { cls: 'hc-detail-nav-btn' });
    setIcon(nextAssignBtn, 'chevron-right');
    nextAssignBtn.disabled = !nextAssign;
    nextAssignBtn.addEventListener('click', () => {
      if (nextAssign) this.navigate('assignment', cls.id, nextAssign.lectureId, nextAssign.assignment.id);
    });

    // Type pill + title
    const titleRow = content.createDiv('hc-assign-detail-title-row');
    const pill = titleRow.createSpan({ cls: 'hc-assign-pill hc-assign-pill--lg', text: assignment.type || 'Other' });
    pill.style.color = typeStyle.color;
    pill.style.background = typeStyle.bg;

    content.createDiv({ cls: 'hc-lecture-detail-title', text: assignment.title });

    // Lecture context
    let lecTitle = 'Class-level';
    if (lectureId) {
      const lec = cls.lectures.find(l => l.id === lectureId);
      if (lec) {
        const sorted = getLecturesSorted(cls);
        const num = sorted.indexOf(lec) + 1;
        lecTitle = `Lecture ${num} — ${lec.title}`;
      }
    }
    content.createDiv({ cls: 'hc-assign-detail-lecture', text: lecTitle });

    // Due date
    if (assignment.dueDate) {
      const info = getDueInfo(assignment.dueDate);
      const dueRow = content.createDiv('hc-assign-detail-due');
      dueRow.createSpan({ text: `Due ${formatDateLong(assignment.dueDate)}` });
      if (info && info.urgency !== 'upcoming' && assignment.status !== 'done') {
        const chip = dueRow.createSpan({ cls: 'hc-assign-detail-due-chip', text: info.note });
        chip.style.color = info.color;
      }
    }

    // Actions row
    const actionsRow = content.createDiv('hc-lecture-detail-actions');

    const statusBtn = actionsRow.createEl('button', { cls: `hc-lecture-status-btn hc-lecture-status-btn--${assignment.status}` });
    statusBtn.setText(statusLabel(assignment.status));
    statusBtn.addEventListener('click', () => {
      assignment.status = cycleStatus(assignment.status);
      this.plugin.save();
      this.render();
    });

    const editBtn = actionsRow.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const editIcon = editBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(editIcon, 'pencil');
    editBtn.createSpan({ text: 'Edit' });
    editBtn.addEventListener('click', () => {
      new EditAssignmentModal(this.app, this.plugin, sem.id, cls, assignment, () => {
        this.plugin.save();
        this.render();
      }).open();
    });

    const moveBtn = actionsRow.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const moveIcon = moveBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(moveIcon, 'move');
    moveBtn.createSpan({ text: 'Move' });
    moveBtn.addEventListener('click', () => {
      new MoveAssignmentModal(this.app, this.plugin, sem.id, cls, assignment, lectureId, () => {
        this.plugin.save();
        // #9: land on Readings after moving a Reading item. (LiveAQuietLife, 2026-09-01)
        this.currentTab = assignment.type === 'Reading' ? 'Readings' : 'Assignments';
        this.navigate('class', cls.id);
      }).open();
    });

    const deleteBtn = actionsRow.createEl('button', { cls: 'hc-btn hc-btn--sm hc-btn--danger' });
    const deleteIcon = deleteBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(deleteIcon, 'trash-2');
    deleteBtn.createSpan({ text: 'Delete' });
    deleteBtn.addEventListener('click', () => {
      new DeleteAssignmentModal(this.app, this.plugin, sem.id, cls.id, assignment, () => {
        this.plugin.save();
        // #9: land on Readings after deleting a Reading item. (LiveAQuietLife, 2026-09-01)
        this.currentTab = assignment.type === 'Reading' ? 'Readings' : 'Assignments';
        this.navigate('class', cls.id);
      }).open();
    });

    // Notes
    content.createDiv({ cls: 'hc-lecture-section-label', text: 'Notes' });
    const textarea = content.createEl('textarea', { cls: 'hc-lecture-notes' });
    textarea.value = assignment.notes || '';
    textarea.placeholder = 'Add notes…';
    textarea.addEventListener('blur', () => {
      assignment.notes = textarea.value;
      this.plugin.save();
    });

    // Grade (not Reading — mirrors the Linked Book gate just below, opposite
    // condition, same mechanism. A reading is never graded, so the field
    // never renders for one; existing data in assignment.grade, if any, is
    // left untouched, just not shown. #9 (LiveAQuietLife, 2026-09-01)
    if (assignment.type !== 'Reading') {
      content.createDiv({ cls: 'hc-lecture-section-label', text: 'Grade' });
      const gradeInput = content.createEl('input', { cls: 'hc-assign-link-input', type: 'text' });
      gradeInput.placeholder = 'e.g. A, 92%, Pass';
      gradeInput.value = assignment.grade || '';
      gradeInput.addEventListener('blur', () => {
        assignment.grade = gradeInput.value;
        this.plugin.save();
      });
    }

    // Linked book (Reading only)
    if (assignment.type === 'Reading') {
      content.createDiv({ cls: 'hc-lecture-section-label', text: 'Linked Book' });
      const bookSection = content.createDiv('hc-assign-book-section');

      const classResources = (sem.resources || []).filter(r => (r.classIds || []).includes(cls.id));
      const linkedResource = assignment.linkedBook ? (sem.resources || []).find(r => r.id === assignment.linkedBook) : null;
      const isOrphaned = assignment.linkedBook && !linkedResource;

      const renderBookSection = () => {
        bookSection.empty();
        const res = assignment.linkedBook ? (sem.resources || []).find(r => r.id === assignment.linkedBook) : null;

        if (res) {
          const bookRow = bookSection.createDiv('hc-assign-book-row');
          const bookLink = bookRow.createDiv('hc-assign-book-link');
          bookLink.createDiv({ cls: 'hc-assign-book-title', text: res.title });
          if (res.author) bookLink.createDiv({ cls: 'hc-assign-book-author', text: res.author });
          bookLink.addEventListener('click', () => this.navigate('resource', cls.id, null, null, null, res.id));

          const bookActions = bookRow.createDiv('hc-assign-book-actions');
          const changeBtn = bookActions.createEl('button', { cls: 'hc-btn hc-btn--sm', text: 'Change' });
          changeBtn.addEventListener('click', () => {
            new ResourcePickSuggestModal(this.app, classResources, (resource) => {
              assignment.linkedBook = resource.id;
              this.plugin.save();
              renderBookSection();
            }, (titleHint) => {
              new QuickAddResourceModal(this.app, this.plugin, sem.id, cls.id, titleHint, (resource) => {
                assignment.linkedBook = resource.id;
                this.plugin.save();
                renderBookSection();
              }).open();
            }).open();
          });
          const removeBtn = bookActions.createEl('button', { cls: 'hc-btn hc-btn--sm', text: 'Remove' });
          removeBtn.addEventListener('click', () => {
            assignment.linkedBook = '';
            this.plugin.save();
            renderBookSection();
          });
        } else {
          const emptyRow = bookSection.createDiv('hc-assign-book-empty');
          if (isOrphaned) emptyRow.createSpan({ cls: 'hc-assign-book-orphan', text: 'Book not found in Library. ' });
          const selectBtn = emptyRow.createEl('button', { cls: 'hc-btn hc-btn--sm', text: 'Select from Library' });
          selectBtn.addEventListener('click', () => {
            new ResourcePickSuggestModal(this.app, classResources, (resource) => {
              assignment.linkedBook = resource.id;
              this.plugin.save();
              renderBookSection();
            }, (titleHint) => {
              new QuickAddResourceModal(this.app, this.plugin, sem.id, cls.id, titleHint, (resource) => {
                assignment.linkedBook = resource.id;
                this.plugin.save();
                renderBookSection();
              }).open();
            }).open();
          });
        }
      };
      renderBookSection();
    }

    // Linked note (all types)
    {
      content.createDiv({ cls: 'hc-lecture-section-label', text: 'Linked Note' });
      const noteSection = content.createDiv('hc-assign-note-section');

      const renderNoteSection = () => {
        noteSection.empty();
        const path = assignment.linkedNote || '';

        const noteRow = noteSection.createDiv('hc-assign-note-row');
        const textWrap = noteRow.createDiv('hc-assign-note-input-wrap');

        if (path) {
          // #8: same treatment as the Lecture Notes field — once a note is
          // linked, show the friendly filename as read-only text instead
          // of an editable input, so an unrelated edit can't silently save
          // a folder-less path over the real one. Browse/Remove are the
          // only way to change an existing link. (LiveAQuietLife/Claude, 2026-08-30)
          textWrap.createDiv({ cls: 'hc-assign-link-display', text: path.split('/').pop() });
        } else {
          const noteInput = textWrap.createEl('input', { cls: 'hc-assign-link-input', type: 'text' });
          noteInput.placeholder = 'path/to/note.md';
          noteInput.value = path;
          noteInput.addEventListener('blur', () => {
            assignment.linkedNote = noteInput.value.trim();
            this.plugin.save();
            renderNoteSection();
          });
        }

        const browseBtn = noteRow.createEl('button', { cls: 'hc-btn hc-btn--sm', text: 'Browse' });
        browseBtn.addEventListener('click', () => {
          new VaultLinkSuggestModal(this.app, (selectedPath) => {
            assignment.linkedNote = selectedPath;
            this.plugin.save();
            renderNoteSection();
          }).open();
        });

        if (path) {
          const openBtn = noteRow.createEl('button', { cls: 'hc-btn hc-btn--sm', text: 'Open note' });
          openBtn.addEventListener('click', () => {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file) this.app.workspace.openLinkText(path, '', false);
            else new Notice('Note not found in vault.');
          });

          const removeBtn = noteRow.createEl('button', { cls: 'hc-btn hc-btn--sm', text: 'Remove' });
          removeBtn.addEventListener('click', () => {
            assignment.linkedNote = '';
            this.plugin.save();
            renderNoteSection();
          });
        }
      };
      renderNoteSection();
    }
  }

  // ─── Exam list ────────────────────────────────────────────────────────────

  _renderExamList(content, sem, cls, color) {
    if (cls.examShowDone === undefined) cls.examShowDone = true;
    const showDone = cls.examShowDone;

    const exams = [...(cls.exams || [])].sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

    const displayed = showDone ? exams : exams.filter(e => e.status !== 'done');

    const controlRow = content.createDiv('hc-assign-controls');
    const doneToggle = controlRow.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const doneIcon = doneToggle.createSpan({ cls: 'hc-btn-icon' });
    setIcon(doneIcon, showDone ? 'eye-off' : 'eye');
    doneToggle.createSpan({ text: showDone ? 'Hide done' : 'Show done' });
    doneToggle.addEventListener('click', () => {
      cls.examShowDone = !cls.examShowDone;
      this.plugin.save();
      this.render();
    });

    const addBtn = controlRow.createEl('button', { cls: 'hc-btn' });
    const addIcon = addBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(addIcon, 'plus');
    addBtn.createSpan({ text: 'Add exam' });
    addBtn.addEventListener('click', () => {
      new AddExamModal(this.app, this.plugin, sem.id, cls, () => {
        this.plugin.save();
        this.render();
      }).open();
    });

    const list = content.createDiv('hc-exam-list');

    if (exams.length === 0) {
      const empty = list.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'No exams yet.' });
    } else if (displayed.length === 0) {
      const empty = list.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'All exams done.' });
    } else {
      for (const exam of displayed) {
        this._renderExamRow(list, exam, sem, cls);
      }
    }
  }

  _renderExamRow(container, exam, sem, cls) {
    const row = container.createDiv('hc-exam-row');

    // Stacked date block
    const dateBlock = row.createDiv('hc-exam-date-block');
    if (exam.dueDate) {
      const d = new Date(exam.dueDate + 'T12:00:00');
      dateBlock.createDiv({
        cls: 'hc-exam-month',
        text: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      });
      dateBlock.createDiv({ cls: 'hc-exam-day', text: String(d.getDate()) });
    } else {
      dateBlock.createDiv({ cls: 'hc-exam-month', text: '—' });
    }

    // Name + countdown
    const info = row.createDiv('hc-exam-info');
    info.createDiv({ cls: 'hc-exam-name', text: exam.title });

    if (exam.status === 'done') {
      if ((exam.grade || '').trim()) {
        info.createSpan({ cls: 'hc-grade-chip hc-grade-chip--exam', text: exam.grade.trim() });
      }
    } else if (exam.dueDate) {
      const diff = getDaysUntil(exam.dueDate);
      let countdownText = '';
      if (diff === 0) countdownText = 'Today';
      else if (diff === 1) countdownText = 'Tomorrow';
      else if (diff > 0) countdownText = `${diff} days away`;
      else countdownText = `${Math.abs(diff)} day${Math.abs(diff) === 1 ? '' : 's'} ago`;

      const chip = info.createSpan({ cls: 'hc-exam-countdown' });
      chip.setText(countdownText);
      if (diff !== null && diff <= 0) chip.addClass('hc-exam-countdown--past');
      else if (diff !== null && diff <= 7) chip.addClass('hc-exam-countdown--soon');
    }

    // Exams are two-state (matches the detail view's done toggle) — no 'in progress'
    const statusEl = row.createDiv({
      cls: `hc-assign-status hc-assign-status--${exam.status === 'done' ? 'done' : 'not-started'} hc-status-clickable hc-exam-status`,
    });
    statusEl.setText(exam.status === 'done' ? 'Done' : 'Mark done');
    statusEl.setAttribute('aria-label', 'Click to change status');
    statusEl.addEventListener('click', (e) => {
      e.stopPropagation();
      exam.status = exam.status === 'done' ? 'not-started' : 'done';
      this.plugin.save();
      this.render();
    });

    row.addEventListener('click', () => this.navigate('exam', cls.id, null, null, exam.id));
  }

  // ─── Exam detail ──────────────────────────────────────────────────────────

  _renderExamDetail(content) {
    const sem = this._getViewedSemester();
    if (!sem) { this.navigate('dashboard'); return; }
    const cls = sem.classes.find(c => c.id === this.currentClassId);
    if (!cls) { this.navigate('dashboard'); return; }
    const exam = this.plugin.findExam(sem.id, cls.id, this.currentExamId);
    if (!exam) { this.currentTab = 'Exams'; this.navigate('class', cls.id); return; }

    const color = getColor(cls.colorIndex);

    // Top bar: back button + prev/next nav
    const examSorted = getExamsSorted(cls);
    const examIdx = examSorted.findIndex(e => e.id === exam.id);
    const prevExam = examIdx > 0 ? examSorted[examIdx - 1] : null;
    const nextExam = examIdx < examSorted.length - 1 ? examSorted[examIdx + 1] : null;

    const topbar = content.createDiv('hc-detail-topbar');
    const backBtn = topbar.createEl('button', { cls: 'hc-btn hc-lecture-back-btn' });
    const backIcon = backBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(backIcon, 'arrow-left');
    backBtn.createSpan({ text: cls.code });
    backBtn.addEventListener('click', () => {
      this.currentTab = 'Exams';
      this.navigate('class', cls.id);
    });

    const examNavEl = topbar.createDiv('hc-detail-nav');
    const prevExamBtn = examNavEl.createEl('button', { cls: 'hc-detail-nav-btn' });
    setIcon(prevExamBtn, 'chevron-left');
    prevExamBtn.disabled = !prevExam;
    prevExamBtn.addEventListener('click', () => {
      if (prevExam) this.navigate('exam', cls.id, null, null, prevExam.id);
    });
    examNavEl.createSpan({ cls: 'hc-detail-nav-pos', text: examIdx >= 0 ? `${examIdx + 1} / ${examSorted.length}` : '' });
    const nextExamBtn = examNavEl.createEl('button', { cls: 'hc-detail-nav-btn' });
    setIcon(nextExamBtn, 'chevron-right');
    nextExamBtn.disabled = !nextExam;
    nextExamBtn.addEventListener('click', () => {
      if (nextExam) this.navigate('exam', cls.id, null, null, nextExam.id);
    });

    // Title
    content.createDiv({ cls: 'hc-lecture-detail-title', text: exam.title });

    // Due date
    if (exam.dueDate) {
      content.createDiv({ cls: 'hc-lecture-detail-date', text: formatDateLong(exam.dueDate) });
    }

    // Actions row
    const actionsRow = content.createDiv('hc-lecture-detail-actions');

    const doneBtn = actionsRow.createEl('button', {
      cls: `hc-lecture-status-btn hc-lecture-status-btn--${exam.status === 'done' ? 'done' : 'not-started'}`,
    });
    doneBtn.setText(exam.status === 'done' ? 'Done' : 'Mark done');
    doneBtn.addEventListener('click', () => {
      exam.status = exam.status === 'done' ? 'not-started' : 'done';
      this.plugin.save();
      this.render();
    });

    const editBtn = actionsRow.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const editIcon = editBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(editIcon, 'pencil');
    editBtn.createSpan({ text: 'Edit' });
    editBtn.addEventListener('click', () => {
      new EditExamModal(this.app, this.plugin, sem.id, cls.id, exam, () => {
        this.plugin.save();
        this.render();
      }).open();
    });

    const deleteBtn = actionsRow.createEl('button', { cls: 'hc-btn hc-btn--sm hc-btn--danger' });
    const deleteIcon = deleteBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(deleteIcon, 'trash-2');
    deleteBtn.createSpan({ text: 'Delete' });
    deleteBtn.addEventListener('click', () => {
      new DeleteExamModal(this.app, this.plugin, sem.id, cls.id, exam, () => {
        this.plugin.save();
        this.currentTab = 'Exams';
        this.navigate('class', cls.id);
      }).open();
    });

    // Notes
    content.createDiv({ cls: 'hc-lecture-section-label', text: 'Notes' });
    const textarea = content.createEl('textarea', { cls: 'hc-lecture-notes' });
    textarea.value = exam.notes || '';
    textarea.placeholder = 'Study scope, topics to review, location…';
    textarea.addEventListener('blur', () => {
      exam.notes = textarea.value;
      this.plugin.save();
    });

    // Grade
    content.createDiv({ cls: 'hc-lecture-section-label', text: 'Grade' });
    const gradeInput = content.createEl('input', { cls: 'hc-assign-link-input', type: 'text' });
    gradeInput.placeholder = 'e.g. A, 92%, Pass';
    gradeInput.value = exam.grade || '';
    gradeInput.addEventListener('blur', () => {
      exam.grade = gradeInput.value;
      this.plugin.save();
    });
  }

  // ─── Library list ─────────────────────────────────────────────────────────

  _renderLibraryList(content, sem, cls, color) {
    let resources = [...(sem.resources || [])];

    // Migrate stale 'class' sort key
    if (sem.librarySort === 'class') sem.librarySort = 'alpha-asc';
    const sortKey = sem.librarySort || 'alpha-asc';

    // Apply class filter
    if (this.libraryFilterClassId) {
      resources = resources.filter(r => (r.classIds || []).includes(this.libraryFilterClassId));
    }

    const statusOrder = { 'in-progress': 0, 'unread': 1, 'done': 2 };
    if (sortKey === 'alpha-asc') {
      resources.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortKey === 'alpha-desc') {
      resources.sort((a, b) => b.title.localeCompare(a.title));
    } else if (sortKey === 'status') {
      resources.sort((a, b) => {
        const sa = statusOrder[a.status] ?? 1;
        const sb = statusOrder[b.status] ?? 1;
        return sa !== sb ? sa - sb : a.title.localeCompare(b.title);
      });
    }

    const sortLabels = { 'alpha-asc': 'A–Z', 'alpha-desc': 'Z–A', 'status': 'By status' };
    const sortCycle  = { 'alpha-asc': 'alpha-desc', 'alpha-desc': 'status', 'status': 'alpha-asc' };
    const sortIcons  = { 'alpha-asc': 'arrow-up-narrow-wide', 'alpha-desc': 'arrow-down-narrow-wide', 'status': 'layers' };

    const controlRow = content.createDiv('hc-resource-controls');

    // Left: class filter
    const libFilterWrap = controlRow.createDiv('hc-global-filter-wrap');
    const libFilterBtn  = libFilterWrap.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const libFilterIcon = libFilterBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(libFilterIcon, 'filter');
    const libFilterLabel = this.libraryFilterClassId
      ? (sem.classes.find(c => c.id === this.libraryFilterClassId)?.code || 'All classes')
      : 'All classes';
    libFilterBtn.createSpan({ cls: 'hc-global-filter-label', text: libFilterLabel });
    const libFilterChev = libFilterBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(libFilterChev, 'chevron-down');

    let libDropEl = null;
    const closeLibDrop = () => { if (libDropEl) { libDropEl.remove(); libDropEl = null; } };
    libFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (libDropEl) { closeLibDrop(); return; }
      libDropEl = libFilterWrap.createDiv('hc-sem-drop');

      const allItem = libDropEl.createDiv('hc-sem-drop-item');
      if (!this.libraryFilterClassId) allItem.addClass('hc-sem-drop-item--active');
      const allIcon = allItem.createSpan({ cls: 'hc-sem-drop-icon' });
      if (!this.libraryFilterClassId) setIcon(allIcon, 'check');
      allItem.createSpan({ text: 'All classes' });
      allItem.addEventListener('click', () => { this.libraryFilterClassId = null; closeLibDrop(); this.render(); });

      libDropEl.createDiv('hc-sem-drop-divider');

      for (const c of (sem.classes || [])) {
        const item = libDropEl.createDiv('hc-sem-drop-item');
        if (c.id === this.libraryFilterClassId) item.addClass('hc-sem-drop-item--active');
        const icon = item.createSpan({ cls: 'hc-sem-drop-icon' });
        if (c.id === this.libraryFilterClassId) setIcon(icon, 'check');
        const lbl = item.createSpan({ text: c.code });
        lbl.style.color = accentText(getColor(c.colorIndex));
        item.addEventListener('click', () => { this.libraryFilterClassId = c.id; closeLibDrop(); this.render(); });
      }

      setTimeout(() => document.addEventListener('click', () => closeLibDrop(), { once: true }), 0);
    });

    // Right: sort + add
    const libRightControls = controlRow.createDiv('hc-global-right-controls');

    const sortBtn = libRightControls.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const sortIcon = sortBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(sortIcon, sortIcons[sortKey]);
    sortBtn.createSpan({ text: sortLabels[sortKey] });
    sortBtn.addEventListener('click', () => {
      sem.librarySort = sortCycle[sortKey];
      this.plugin.save();
      this.render();
    });

    const addBtn = libRightControls.createEl('button', { cls: 'hc-btn' });
    const addIcon = addBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(addIcon, 'plus');
    addBtn.createSpan({ text: 'Add resource' });
    addBtn.addEventListener('click', () => {
      new AddResourceModal(this.app, this.plugin, sem.id, sem.classes, () => {
        this.plugin.save();
        this.render();
      }).open();
    });

    const list = content.createDiv('hc-resource-list');

    if (resources.length === 0) {
      const empty = list.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'No resources yet. Add your first one above.' });
    } else {
      for (const resource of resources) {
        this._renderLibraryRow(list, resource, sem, cls);
      }
    }
  }

  _renderLibraryRow(container, resource, sem, cls) {
    const row = container.createDiv('hc-resource-row');

    const main = row.createDiv('hc-resource-main');
    main.createDiv({ cls: 'hc-resource-title', text: resource.title });
    if (resource.author) {
      main.createDiv({ cls: 'hc-resource-author', text: resource.author });
    }

    const right = row.createDiv('hc-resource-right');

    if (resource.classIds && resource.classIds.length > 0) {
      const chipsEl = right.createDiv('hc-resource-class-chips');
      for (const classId of resource.classIds) {
        const c = sem.classes.find(x => x.id === classId);
        if (c) {
          const chip = chipsEl.createSpan({ cls: 'hc-resource-class-chip', text: c.code });
          chip.style.color = accentText(getColor(c.colorIndex));
          chip.style.background = getColor(c.colorIndex).bg;
        }
      }
    }

    const statusEl = right.createDiv({ cls: `hc-resource-status hc-resource-status--${resource.status || 'unread'}` });
    statusEl.setText(resourceStatusLabel(resource.status || 'unread'));

    row.addEventListener('click', () => this.navigate('resource', cls.id, null, null, null, resource.id));
  }

  // ─── Resource detail ──────────────────────────────────────────────────────

  _renderResourceDetail(content) {
    const sem = this._getViewedSemester();
    if (!sem) { this.navigate('dashboard'); return; }
    const cls = sem.classes.find(c => c.id === this.currentClassId);
    if (!cls) { this.navigate('dashboard'); return; }
    const resource = this.plugin.findResource(sem.id, this.currentResourceId);
    if (!resource) { this.currentTab = 'Library'; this.navigate('class', cls.id); return; }

    const color = getColor(cls.colorIndex);

    // Back button
    const backBtn = content.createEl('button', { cls: 'hc-btn hc-lecture-back-btn' });
    const backIcon = backBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(backIcon, 'arrow-left');
    backBtn.createSpan({ text: cls.code });
    backBtn.addEventListener('click', () => {
      this.currentTab = 'Library';
      this.navigate('class', cls.id);
    });

    // Title
    content.createDiv({ cls: 'hc-lecture-detail-title', text: resource.title });

    // Author
    if (resource.author) {
      content.createDiv({ cls: 'hc-resource-detail-author', text: resource.author });
    }

    // Actions row
    const actionsRow = content.createDiv('hc-lecture-detail-actions');

    const statusBtn = actionsRow.createEl('button', { cls: `hc-lecture-status-btn hc-lecture-status-btn--${resource.status || 'unread'}` });
    statusBtn.setText(resourceStatusLabel(resource.status || 'unread'));
    statusBtn.addEventListener('click', () => {
      resource.status = cycleResourceStatus(resource.status || 'unread');
      this.plugin.save();
      this.render();
    });

    const editBtn = actionsRow.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const editIcon = editBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(editIcon, 'pencil');
    editBtn.createSpan({ text: 'Edit' });
    editBtn.addEventListener('click', () => {
      new EditResourceModal(this.app, this.plugin, sem.id, sem.classes, resource, () => {
        this.plugin.save();
        this.render();
      }).open();
    });

    const deleteBtn = actionsRow.createEl('button', { cls: 'hc-btn hc-btn--sm hc-btn--danger' });
    const deleteIcon = deleteBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(deleteIcon, 'trash-2');
    deleteBtn.createSpan({ text: 'Delete' });
    deleteBtn.addEventListener('click', () => {
      new DeleteResourceModal(this.app, this.plugin, sem.id, resource, () => {
        this.plugin.save();
        this.currentTab = 'Library';
        this.navigate('class', cls.id);
      }).open();
    });

    // Classes
    if (resource.classIds && resource.classIds.length > 0) {
      content.createDiv({ cls: 'hc-lecture-section-label', text: 'Classes' });
      const chipsRow = content.createDiv('hc-resource-detail-chips');
      for (const classId of resource.classIds) {
        const c = sem.classes.find(x => x.id === classId);
        if (c) {
          const chip = chipsRow.createSpan({ cls: 'hc-resource-class-chip', text: c.code });
          chip.style.color = accentText(getColor(c.colorIndex));
          chip.style.background = getColor(c.colorIndex).bg;
        }
      }
    }

    // Type
    if (resource.type) {
      content.createDiv({ cls: 'hc-lecture-section-label', text: 'Type' });
      content.createDiv({ cls: 'hc-resource-detail-type', text: resource.type });
    }

    // Sources
    const hasVault = !!resource.vaultLink;
    const hasUrl = !!resource.url;

    if (hasVault || hasUrl) {
      content.createDiv({ cls: 'hc-lecture-section-label', text: 'Sources' });
      const sourcesEl = content.createDiv('hc-resource-sources');

      if (hasVault) {
        const vaultRow = sourcesEl.createDiv('hc-resource-source-row');
        const vaultIcon = vaultRow.createSpan({ cls: 'hc-resource-source-icon' });
        setIcon(vaultIcon, 'file');
        const vaultInfo = vaultRow.createDiv('hc-resource-source-info');
        vaultInfo.createDiv({ cls: 'hc-resource-source-label', text: 'Vault link' });
        // #8: show just the filename, not the full vault path — raw paths
        // were noisy and unhelpful once nested in subfolders (fastermadman)
        vaultInfo.createDiv({ cls: 'hc-resource-source-path', text: resource.vaultLink.split('/').pop() });
        const openIcon = vaultRow.createSpan({ cls: 'hc-resource-source-open' });
        setIcon(openIcon, 'external-link');
        vaultRow.addEventListener('click', () => {
          this.app.workspace.openLinkText(resource.vaultLink, '', false);
        });
      }

      if (hasUrl) {
        const urlRow = sourcesEl.createDiv('hc-resource-source-row');
        const urlIcon = urlRow.createSpan({ cls: 'hc-resource-source-icon' });
        setIcon(urlIcon, 'globe');
        const urlInfo = urlRow.createDiv('hc-resource-source-info');
        urlInfo.createDiv({ cls: 'hc-resource-source-label', text: 'URL' });
        urlInfo.createDiv({ cls: 'hc-resource-source-path', text: resource.url });
        const openIcon = urlRow.createSpan({ cls: 'hc-resource-source-open' });
        setIcon(openIcon, 'external-link');
        urlRow.addEventListener('click', () => {
          window.open(resource.url, '_blank');
        });
      }
    }

    // Referenced by
    const allRefs = [];
    for (const c of (sem.classes || [])) {
      for (const a of (c.assignments || [])) {
        if (a.linkedBook === resource.id) {
          allRefs.push({ assignment: a, refCls: c, lectureLabel: 'Class-level' });
        }
      }
      const lecsSorted = getLecturesSorted(c);
      lecsSorted.forEach((lec, i) => {
        for (const a of (lec.assignments || [])) {
          if (a.linkedBook === resource.id) {
            allRefs.push({ assignment: a, refCls: c, lectureLabel: `L${i + 1} — ${lec.title}` });
          }
        }
      });
    }

    if (allRefs.length > 0) {
      content.createDiv({
        cls: 'hc-lecture-section-label',
        text: `Referenced by ${allRefs.length} assignment${allRefs.length === 1 ? '' : 's'}`,
      });
      const refList = content.createDiv('hc-resource-refs');
      for (const { assignment, refCls, lectureLabel } of allRefs) {
        const refRow = refList.createDiv('hc-resource-ref-row');

        const chip = refRow.createSpan({ cls: 'hc-resource-class-chip', text: refCls.code });
        chip.style.color = accentText(getColor(refCls.colorIndex));
        chip.style.background = getColor(refCls.colorIndex).bg;

        const refInfo = refRow.createDiv('hc-resource-ref-info');
        refInfo.createDiv({ cls: 'hc-resource-ref-title', text: assignment.title });
        refInfo.createDiv({ cls: 'hc-resource-ref-lecture', text: lectureLabel });

        const chevron = refRow.createSpan({ cls: 'hc-resource-ref-chevron' });
        setIcon(chevron, 'chevron-right');

        // refCls can be a *different* class in the same semester, which trips
        // the class-changed reset in navigate(). Forward the id or the jump
        // would silently fall back to the current semester.
        refRow.addEventListener('click', () => this.navigate('assignment', refCls.id, null, assignment.id, null, null, this.viewedSemesterId));
      }
    }

    // Notes
    content.createDiv({ cls: 'hc-lecture-section-label', text: 'Notes' });
    const textarea = content.createEl('textarea', { cls: 'hc-lecture-notes' });
    textarea.value = resource.notes || '';
    textarea.placeholder = 'Add notes…';
    textarea.addEventListener('blur', () => {
      resource.notes = textarea.value;
      this.plugin.save();
    });
  }

  // ─── Assignments (global) ─────────────────────────────────────────────────

  _renderAssignmentsView(content) {
    const sem = this.plugin.getCurrentSemester();
    if (!sem) {
      const empty = content.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'No semester found.' });
      return;
    }

    const SORT_OPTIONS = [
      { key: 'due',    label: 'By due date' },
      { key: 'class',  label: 'By class'    },
      { key: 'status', label: 'By status'   },
    ];
    if (!sem.assignSort || sem.assignSort === 'type') sem.assignSort = 'due';
    if (sem.assignShowDone === undefined) sem.assignShowDone = false;

    const currentSort = SORT_OPTIONS.find(o => o.key === sem.assignSort) || SORT_OPTIONS[0];
    const showDone    = sem.assignShowDone;
    const classes     = sem.classes || [];

    // ── Controls row ──────────────────────────────────────────────────────────
    const controlRow = content.createDiv('hc-assign-controls hc-global-controls');

    // Left: class filter + type filter
    const leftFilters = controlRow.createDiv('hc-global-left-filters');

    // Class filter dropdown
    const filterWrap = leftFilters.createDiv('hc-global-filter-wrap');
    const filterBtn  = filterWrap.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const filterIcon = filterBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(filterIcon, 'filter');
    const filterLabel = this.globalAssignFilterClassId
      ? (classes.find(c => c.id === this.globalAssignFilterClassId)?.code || 'All classes')
      : 'All classes';
    filterBtn.createSpan({ cls: 'hc-global-filter-label', text: filterLabel });
    const filterChev = filterBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(filterChev, 'chevron-down');

    let filterDropEl = null;
    const closeFilterDrop = () => { if (filterDropEl) { filterDropEl.remove(); filterDropEl = null; } };
    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (filterDropEl) { closeFilterDrop(); return; }
      filterDropEl = filterWrap.createDiv('hc-sem-drop');

      const allItem = filterDropEl.createDiv('hc-sem-drop-item');
      if (!this.globalAssignFilterClassId) allItem.addClass('hc-sem-drop-item--active');
      const allIcon = allItem.createSpan({ cls: 'hc-sem-drop-icon' });
      if (!this.globalAssignFilterClassId) setIcon(allIcon, 'check');
      allItem.createSpan({ text: 'All classes' });
      allItem.addEventListener('click', () => {
        this.globalAssignFilterClassId = null;
        closeFilterDrop();
        this.render();
      });

      filterDropEl.createDiv('hc-sem-drop-divider');

      for (const cls of classes) {
        const item = filterDropEl.createDiv('hc-sem-drop-item');
        if (cls.id === this.globalAssignFilterClassId) item.addClass('hc-sem-drop-item--active');
        const icon = item.createSpan({ cls: 'hc-sem-drop-icon' });
        if (cls.id === this.globalAssignFilterClassId) setIcon(icon, 'check');
        const label = item.createSpan({ text: cls.code });
        label.style.color = accentText(getColor(cls.colorIndex));
        item.addEventListener('click', () => {
          this.globalAssignFilterClassId = cls.id;
          closeFilterDrop();
          this.render();
        });
      }

      setTimeout(() => document.addEventListener('click', () => closeFilterDrop(), { once: true }), 0);
    });

    // Type filter dropdown
    const typeFilterWrap = leftFilters.createDiv('hc-global-filter-wrap');
    const typeFilterBtn  = typeFilterWrap.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const typeFilterIcon = typeFilterBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(typeFilterIcon, 'tag');
    typeFilterBtn.createSpan({ cls: 'hc-global-filter-label', text: this.globalAssignFilterType || 'All types' });
    const typeFilterChev = typeFilterBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(typeFilterChev, 'chevron-down');

    let typeDropEl = null;
    const closeTypeDrop = () => { if (typeDropEl) { typeDropEl.remove(); typeDropEl = null; } };
    typeFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeDropEl) { closeTypeDrop(); return; }
      typeDropEl = typeFilterWrap.createDiv('hc-sem-drop');

      const allTypeItem = typeDropEl.createDiv('hc-sem-drop-item');
      if (!this.globalAssignFilterType) allTypeItem.addClass('hc-sem-drop-item--active');
      const allTypeIcon = allTypeItem.createSpan({ cls: 'hc-sem-drop-icon' });
      if (!this.globalAssignFilterType) setIcon(allTypeIcon, 'check');
      allTypeItem.createSpan({ text: 'All types' });
      allTypeItem.addEventListener('click', () => {
        this.globalAssignFilterType = null;
        closeTypeDrop();
        this.render();
      });

      typeDropEl.createDiv('hc-sem-drop-divider');

      for (const type of ASSIGNMENT_TYPES) {
        const typeStyle = getTypeStyle(type);
        const item = typeDropEl.createDiv('hc-sem-drop-item');
        if (type === this.globalAssignFilterType) item.addClass('hc-sem-drop-item--active');
        const icon = item.createSpan({ cls: 'hc-sem-drop-icon' });
        if (type === this.globalAssignFilterType) setIcon(icon, 'check');
        const lbl = item.createSpan({ text: type });
        lbl.style.color = typeText(typeStyle);
        item.addEventListener('click', () => {
          this.globalAssignFilterType = type;
          closeTypeDrop();
          this.render();
        });
      }

      setTimeout(() => document.addEventListener('click', () => closeTypeDrop(), { once: true }), 0);
    });

    // Right side controls
    const rightControls = controlRow.createDiv('hc-global-right-controls');

    // Show done toggle
    const doneToggle = rightControls.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const doneIcon = doneToggle.createSpan({ cls: 'hc-btn-icon' });
    setIcon(doneIcon, showDone ? 'eye-off' : 'eye');
    doneToggle.createSpan({ text: showDone ? 'Hide done' : 'Show done' });
    doneToggle.addEventListener('click', () => {
      sem.assignShowDone = !sem.assignShowDone;
      this.plugin.save();
      this.render();
    });

    // Sort cycle button (3 options: due / class / status)
    const sortBtn = rightControls.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const sortIcon = sortBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(sortIcon, 'arrow-up-narrow-wide');
    sortBtn.createSpan({ text: currentSort.label });
    sortBtn.addEventListener('click', () => {
      const idx = SORT_OPTIONS.findIndex(o => o.key === sem.assignSort);
      sem.assignSort = SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length].key;
      this.plugin.save();
      this.render();
    });

    // ── Gather + filter + sort ────────────────────────────────────────────────
    let allAssigns = getAllAssignments(sem);

    if (this.globalAssignFilterClassId) {
      allAssigns = allAssigns.filter(a => a.classId === this.globalAssignFilterClassId);
    }
    if (this.globalAssignFilterType) {
      allAssigns = allAssigns.filter(a => a.type === this.globalAssignFilterType);
    }
    if (!showDone) {
      allAssigns = allAssigns.filter(a => a.status !== 'done');
    }

    const STATUS_ORDER = { 'overdue': 0, 'today': 1, 'soon': 2, 'upcoming': 3, 'done': 4, 'none': 5 };
    const getUrgency = (a) => a.dueDate ? (getDueInfo(a.dueDate)?.urgency || 'upcoming') : 'none';

    if (sem.assignSort === 'due') {
      allAssigns.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    } else if (sem.assignSort === 'class') {
      allAssigns.sort((a, b) => {
        const ca = a.classCode || '', cb = b.classCode || '';
        if (ca !== cb) return ca.localeCompare(cb);
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    } else if (sem.assignSort === 'status') {
      allAssigns.sort((a, b) => {
        const ua = STATUS_ORDER[getUrgency(a)] ?? 5;
        const ub = STATUS_ORDER[getUrgency(b)] ?? 5;
        if (ua !== ub) return ua - ub;
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    }

    // ── List ──────────────────────────────────────────────────────────────────
    const list = content.createDiv('hc-assign-list');

    if (allAssigns.length === 0) {
      const empty = list.createDiv('hc-empty');
      empty.createDiv({
        cls: 'hc-empty-text',
        text: showDone ? 'No assignments found.' : 'No pending assignments.',
      });
      return;
    }

    for (const a of allAssigns) {
      const cls = classes.find(c => c.id === a.classId);
      if (!cls) continue;

      const typeStyle = getTypeStyle(a.type);
      const info      = a.dueDate ? getDueInfo(a.dueDate) : null;
      const color     = getColor(cls.colorIndex);

      const row = list.createDiv('hc-assign-row');
      if (a.status === 'done') row.addClass('hc-assign-row--done');

      // Type pill
      const pill = row.createSpan({ cls: 'hc-assign-pill', text: a.type || 'Other' });
      pill.style.color = typeStyle.color;
      pill.style.background = typeStyle.bg;

      // Middle: title, class chip + lecture context, grade (once done)
      const mid = row.createDiv('hc-assign-mid');
      mid.createDiv({ cls: 'hc-assign-title', text: a.title });

      const contextRow = mid.createDiv('hc-assign-context-row');
      const classChip  = contextRow.createSpan({ cls: 'hc-assign-class-chip', text: cls.code });
      classChip.style.color = accentText(color);

      let lecLabel = 'Class-level';
      if (a.lectureId) {
        const lec = (cls.lectures || []).find(l => l.id === a.lectureId);
        if (lec) {
          const sorted = getLecturesSorted(cls);
          const num    = sorted.indexOf(lec) + 1;
          lecLabel     = `L${num} — ${lec.title}`;
        }
      }
      contextRow.createSpan({ cls: 'hc-assign-lecture', text: ` · ${lecLabel}` });

      if (a.status === 'done' && (a.grade || '').trim()) {
        mid.createSpan({ cls: 'hc-grade-chip', text: a.grade.trim() });
      }

      // Right: status (matches the lecture/exam position), then due date
      const right = row.createDiv('hc-assign-due');

      const statusEl = right.createDiv({ cls: `hc-assign-status hc-assign-status--${a.status} hc-status-clickable` });
      statusEl.setText(statusLabel(a.status));
      statusEl.setAttribute('aria-label', 'Click to change status');
      statusEl.addEventListener('click', (e) => {
        e.stopPropagation();
        // Rows here are spread copies from getAllAssignments — mutate the real object
        const found = this.plugin.findAssignment(sem.id, a.classId, a.id);
        if (found) {
          found.assignment.status = cycleStatus(found.assignment.status);
          this.plugin.save();
          this.render();
        }
      });

      if (info) {
        right.createDiv({ cls: 'hc-assign-due-label', text: 'Due' });
        const dateEl = right.createDiv({ cls: 'hc-assign-due-date', text: formatDate(a.dueDate) });
        if (a.status !== 'done') {
          dateEl.style.color = info.color;
          if (info.urgency === 'overdue') {
            right.createDiv({ cls: 'hc-assign-due-note', text: 'Overdue' }).style.color = info.color;
          } else if (info.urgency !== 'upcoming') {
            right.createDiv({ cls: 'hc-assign-due-note', text: info.note }).style.color = info.color;
          } else {
            right.createDiv({ cls: 'hc-assign-due-note', text: info.note });
          }
        }
      }

      row.addEventListener('click', () => this.navigate('assignment', cls.id, null, a.id));
    }
  }


  // ─── Courses ──────────────────────────────────────────────────────────────

  // Lifecycle order, not alphabetical. Sorting Completed / Dropped / Ongoing by
  // first letter would be sorting noise.
  _statusRank(cls) {
    const s = cls.status || null;
    if (s === 'ongoing') return 1;
    if (s === 'completed') return 2;
    if (s === 'dropped') return 3;
    return 0; // unset
  }

  // Clicking a new column applies that column's natural direction; clicking the
  // active column toggles. So the first click on anything is always useful.
  _coursesSortBy(key) {
    if (this.coursesSortKey === key) {
      this.coursesSortDir = this.coursesSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.coursesSortKey = key;
      this.coursesSortDir = key === 'semester' ? 'desc' : 'asc';
    }
    this.render();
  }

  // Shared filter dropdown for the Courses view. Local closure over its own
  // panel element — the toolbar's this._semDropEl slot holds exactly one panel
  // and cannot be shared by two filters.
  _renderCoursesFilter(parent, opts) {
    const wrap = parent.createDiv('hc-global-filter-wrap');
    const btn = wrap.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const icon = btn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(icon, opts.icon);
    btn.createSpan({ cls: 'hc-global-filter-label', text: opts.label });
    const chev = btn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(chev, 'chevron-down');

    let dropEl = null;
    const close = () => { if (dropEl) { dropEl.remove(); dropEl = null; } };

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropEl) { close(); return; }
      dropEl = wrap.createDiv('hc-sem-drop');

      opts.options.forEach((opt, i) => {
        const item = dropEl.createDiv('hc-sem-drop-item');
        const active = opt.value === opts.current;
        if (active) item.addClass('hc-sem-drop-item--active');
        const tick = item.createSpan({ cls: 'hc-sem-drop-icon' });
        if (active) setIcon(tick, 'check');
        item.createSpan({ text: opt.label });
        item.addEventListener('click', () => { close(); opts.onPick(opt.value); });
        if (i === 0 && opts.options.length > 1) dropEl.createDiv('hc-sem-drop-divider');
      });

      setTimeout(() => document.addEventListener('click', () => close(), { once: true }), 0);
    });
  }

  _renderCoursesView(content) {
    const sems = this.plugin.data.semesters || [];

    // ── Filter ────────────────────────────────────────────────────────────────
    const visible = sems.filter(s => {
      if (this.coursesFilterYear !== null && s.year !== this.coursesFilterYear) return false;
      if (this.coursesFilterTerm !== null && s.term !== this.coursesFilterTerm) return false;
      return true;
    });

    // Flatten to rows. An empty semester simply contributes none — no heading,
    // no placeholder line, nothing to accumulate as clutter.
    const rows = [];
    for (const sem of visible) {
      for (const cls of (sem.classes || [])) rows.push({ sem, cls });
    }

    // ── Header ────────────────────────────────────────────────────────────────
    const header = content.createDiv('hc-dash-header');
    const titleWrap = header.createDiv('hc-dash-title-wrap');
    titleWrap.createDiv({ cls: 'hc-courses-title', text: 'Courses' });
    // Counts describe what is on screen, so they never disagree with the table.
    titleWrap.createDiv({
      cls: 'hc-dash-subtitle',
      text: `${rows.length} ${rows.length === 1 ? 'class' : 'classes'} · ` +
            `${visible.length} ${visible.length === 1 ? 'semester' : 'semesters'}`,
    });

    // ── Empty state — nothing exists at all ───────────────────────────────────
    if (sems.length === 0) {
      const empty = content.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'Create a semester to get started.' });
      const btn = empty.createEl('button', { cls: 'hc-btn', text: 'Create semester' });
      btn.addEventListener('click', () => {
        new AddSemesterModal(this.app, this.plugin, () => {
          this.plugin.save();
          this.render();
        }).open();
      });
      return;
    }

    // ── Filters ───────────────────────────────────────────────────────────────
    const years = [...new Set(
      sems.map(s => s.year).filter(y => typeof y === 'number')
    )].sort((a, b) => b - a);
    const terms = TERMS.filter(t => sems.some(s => s.term === t));

    if (years.length || terms.length) {
      const controlRow = content.createDiv('hc-assign-controls');
      const left = controlRow.createDiv('hc-global-left-filters');

      if (years.length) {
        this._renderCoursesFilter(left, {
          icon: 'calendar-range',
          label: this.coursesFilterYear === null ? 'All years' : String(this.coursesFilterYear),
          current: this.coursesFilterYear,
          options: [{ value: null, label: 'All years' }]
            .concat(years.map(y => ({ value: y, label: String(y) }))),
          onPick: v => { this.coursesFilterYear = v; this.render(); },
        });
      }

      if (terms.length) {
        this._renderCoursesFilter(left, {
          icon: 'filter',
          label: this.coursesFilterTerm === null ? 'All terms' : this.coursesFilterTerm,
          current: this.coursesFilterTerm,
          options: [{ value: null, label: 'All terms' }]
            .concat(terms.map(t => ({ value: t, label: t }))),
          onPick: v => { this.coursesFilterTerm = v; this.render(); },
        });
      }
    }

    if (rows.length === 0) {
      const empty = content.createDiv('hc-empty');
      empty.createDiv({
        cls: 'hc-empty-text',
        text: (this.coursesFilterYear !== null || this.coursesFilterTerm !== null)
          ? 'No classes match these filters.'
          : 'No classes yet.',
      });
      return;
    }

    // ── Sort ──────────────────────────────────────────────────────────────────
    const dir = this.coursesSortDir === 'desc' ? -1 : 1;
    const txt = (v) => (v || '');

    // Secondary sort is ALWAYS semester, newest first, then code. Permanent
    // decision: two rows with equal primary keys must not depend on array order.
    const bySemester = (a, b) => compareSemestersByTimeline(a.sem, b.sem, -1);

    const tiebreak = (a, b) =>
      bySemester(a, b) || txt(a.cls.code).localeCompare(txt(b.cls.code));

    rows.sort((a, b) => {
      let primary = 0;
      if (this.coursesSortKey === 'semester') {
        primary = compareSemestersByTimeline(a.sem, b.sem, dir);
      } else if (this.coursesSortKey === 'code') {
        primary = dir * txt(a.cls.code).localeCompare(txt(b.cls.code));
      } else if (this.coursesSortKey === 'course') {
        primary = dir * txt(a.cls.name).localeCompare(txt(b.cls.name));
      } else if (this.coursesSortKey === 'status') {
        primary = dir * (this._statusRank(a.cls) - this._statusRank(b.cls));
      }
      return primary || tiebreak(a, b);
    });

    // ── Table ─────────────────────────────────────────────────────────────────
    const table = content.createDiv('hc-courses-table');

    const headRow = table.createDiv('hc-courses-head');
    const cols = [
      { key: 'semester', label: 'Semester' },
      { key: 'code',     label: 'Code' },
      { key: 'course',   label: 'Course' },
      { key: 'status',   label: 'Status' },
    ];
    for (const col of cols) {
      const th = headRow.createDiv('hc-courses-th');
      th.createSpan({ text: col.label });
      if (this.coursesSortKey === col.key) {
        th.addClass('hc-courses-th--active');
        const arrow = th.createSpan({ cls: 'hc-courses-sort-icon' });
        setIcon(arrow, this.coursesSortDir === 'asc' ? 'chevron-up' : 'chevron-down');
      }
      th.addEventListener('click', () => this._coursesSortBy(col.key));
    }

    // Seams mark where the semester changes, but only while the table is
    // actually ordered by semester — otherwise they would divide nothing.
    const seams = this.coursesSortKey === 'semester';
    let prevSemId = null;

    for (const { sem, cls } of rows) {
      const status = cls.status || null;
      const row = table.createDiv('hc-courses-row');
      if (seams && prevSemId !== null && sem.id !== prevSemId) {
        row.addClass('hc-courses-row--seam');
      }
      prevSemId = sem.id;
      if (status === 'completed' || status === 'dropped') {
        row.addClass('hc-courses-row--inactive');
      }

      const semCell = row.createDiv('hc-courses-sem');
      semCell.createSpan({ text: sem.name });
      if (typeof sem.year !== 'number') {
        semCell.createSpan({ cls: 'hc-courses-sem-tag', text: 'Undated' });
      }

      const codeEl = row.createDiv({ cls: 'hc-courses-code', text: cls.code });
      codeEl.style.color = accentText(getColor(cls.colorIndex));

      row.createDiv({ cls: 'hc-courses-name', text: cls.name });

      const statusEl = row.createDiv({
        cls: `hc-courses-status hc-courses-status--${status || 'unset'}`,
        text: classStatusLabel(status),
      });
      statusEl.setAttribute('aria-label', 'Set class status');
      statusEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = new Menu();
        // Not set comes first and stays reachable, so setting a status is
        // never a one-way door.
        const options = [{ value: null, label: 'Not set' }].concat(
          CLASS_STATUSES.map(s => ({ value: s, label: classStatusLabel(s) }))
        );
        for (const opt of options) {
          menu.addItem(item => item
            .setTitle(opt.label)
            .setChecked(opt.value === status)
            .onClick(() => {
              // delete rather than = null: a cleared class and a brand-new
              // one then look identical in data.json, which is the truth.
              if (opt.value === null) delete cls.status;
              else cls.status = opt.value;
              this.plugin.save();
              this.render();
            }));
        }
        menu.showAtMouseEvent(e);
      });

      // Row actions. Right-click rather than a persistent button: Courses is a
      // quiet table and a "..." on every row would be visual noise for an action
      // most people never need. Appears only when there is somewhere to move to.
      row.addEventListener('contextmenu', (e) => {
        if (!this.plugin.moveTargetsFor(sem.id).length) return;
        e.preventDefault();
        e.stopPropagation();
        const menu = new Menu();
        menu.addItem(item => item
          .setTitle('Move to semester…')
          .setIcon('arrow-right-left')
          .onClick(() => {
            new MoveClassModal(this.app, this.plugin, sem.id, cls, () => {
              this.plugin.save();
              this.render();
            }).open();
          }));
        menu.showAtMouseEvent(e);
      });

      row.addEventListener('click', () => {
        // Courses spans every semester. Carry this row's semester forward as
        // transient view state rather than switching the current semester —
        // looking at an old term's class is not the same as being in that term.
        this.navigate('class', cls.id, null, null, null, null, sem.id);
      });
    }
  }

  _renderCalendarView(content) {
    const sem = this.plugin.getCurrentSemester();
    if (!sem) {
      const empty = content.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'No semester found.' });
      return;
    }

    const today = new Date();
    if (this.calYear === null)  this.calYear  = today.getFullYear();
    if (this.calMonth === null) this.calMonth = today.getMonth();
    if (!this.calWeekStart)    this.calWeekStart = getWeekStartISO(getTodayISO());

    // ── Controls row ──────────────────────────────────────────────────────────
    const controls = content.createDiv('hc-cal-controls');

    const toggle = controls.createDiv('hc-cal-view-toggle');
    const monthBtn = toggle.createEl('button', { cls: 'hc-cal-toggle-btn', text: 'Month' });
    if (this.calView === 'month') monthBtn.addClass('hc-cal-toggle-btn--active');
    const weekBtn = toggle.createEl('button', { cls: 'hc-cal-toggle-btn', text: 'Week' });
    if (this.calView === 'week') weekBtn.addClass('hc-cal-toggle-btn--active');
    monthBtn.addEventListener('click', () => { this.calView = 'month'; this.render(); });
    weekBtn.addEventListener('click',  () => { this.calView = 'week';  this.render(); });

    const nav = controls.createDiv('hc-cal-nav');
    const prevBtn = nav.createEl('button', { cls: 'hc-cal-nav-btn' });
    setIcon(prevBtn, 'chevron-left');
    const titleEl = nav.createDiv('hc-cal-nav-title');
    const nextBtn = nav.createEl('button', { cls: 'hc-cal-nav-btn' });
    setIcon(nextBtn, 'chevron-right');

    const MONTH_NAMES = ['January','February','March','April','May','June',
                         'July','August','September','October','November','December'];

    if (this.calView === 'month') {
      titleEl.setText(`${MONTH_NAMES[this.calMonth]} ${this.calYear}`);
      prevBtn.addEventListener('click', () => {
        this.calMonth--;
        if (this.calMonth < 0) { this.calMonth = 11; this.calYear--; }
        this.render();
      });
      nextBtn.addEventListener('click', () => {
        this.calMonth++;
        if (this.calMonth > 11) { this.calMonth = 0; this.calYear++; }
        this.render();
      });
      this._renderCalLegend(content, sem);
      this._renderMonthGrid(content, sem);
    } else {
      const weekEndISO = addDaysISO(this.calWeekStart, 6);
      const ws = new Date(this.calWeekStart + 'T12:00:00');
      const we = new Date(weekEndISO      + 'T12:00:00');
      const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      titleEl.setText(`${fmt(ws)} – ${fmt(we)}`);
      prevBtn.addEventListener('click', () => { this.calWeekStart = addDaysISO(this.calWeekStart, -7); this.render(); });
      nextBtn.addEventListener('click', () => { this.calWeekStart = addDaysISO(this.calWeekStart,  7); this.render(); });
      this._renderCalLegend(content, sem);
      this._renderWeekGrid(content, sem);
    }

    this._renderCalFilterBar(content, sem);
  }

  _renderCalLegend(content, sem) {
    const classes = sem.classes || [];
    if (classes.length === 0) return;

    const legend = content.createDiv('hc-cal-legend');

    // Lectures group — colored by class
    const classGroup = legend.createDiv('hc-cal-legend-group');
    classGroup.createSpan({ cls: 'hc-cal-legend-grouplabel', text: 'Lectures' });
    for (const cls of classes) {
      const c = getColor(cls.colorIndex);
      const item = classGroup.createDiv('hc-cal-legend-item');
      const dot = item.createDiv('hc-cal-legend-dot');
      dot.style.background = c.accent;
      item.createSpan({ cls: 'hc-cal-legend-label', text: cls.code });
    }

    legend.createDiv('hc-cal-legend-sep');

    // Assignment types group
    const typeGroup = legend.createDiv('hc-cal-legend-group');
    typeGroup.createSpan({ cls: 'hc-cal-legend-grouplabel', text: 'Assignments' });
    const typesToShow = ['Reading', 'Writing', 'Discussion', 'Project', 'Exam', 'Other'];
    for (const type of typesToShow) {
      const style = getTypeStyle(type);
      const item = typeGroup.createDiv('hc-cal-legend-item');
      const dot = item.createDiv('hc-cal-legend-dot');
      dot.style.background = style.color;
      item.createSpan({ cls: 'hc-cal-legend-label', text: type });
    }
  }

  _renderMonthGrid(content, sem) {
    const todayISO = getTodayISO();
    const firstISO = makeISO(this.calYear, this.calMonth + 1, 1);
    const firstD   = new Date(firstISO + 'T12:00:00');
    const startOffset = (firstD.getDay() + 6) % 7;
    const gridStartISO = addDaysISO(firstISO, -startOffset);

    const grid = content.createDiv('hc-cal-grid');

    for (const d of ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']) {
      grid.createDiv({ cls: 'hc-cal-day-header', text: d });
    }

    for (let i = 0; i < 42; i++) {
      const dateISO = addDaysISO(gridStartISO, i);
      const d = new Date(dateISO + 'T12:00:00');
      const inMonth = d.getMonth() === this.calMonth && d.getFullYear() === this.calYear;
      const isToday = dateISO === todayISO;
      const items   = this._applyCalKindFilter(getItemsForDate(sem, dateISO, this.calFilterClassId));

      const cell = grid.createDiv('hc-cal-cell');
      if (isToday)  cell.addClass('hc-cal-cell--today');
      if (!inMonth) cell.addClass('hc-cal-cell--other-month');
      if (items.length > 0) {
        cell.addClass('hc-cal-cell--has-items');
        cell.addEventListener('click', () => this._showCalPopover(items, cell, dateISO));
      }

      const dateNum = cell.createDiv('hc-cal-date-num');
      dateNum.setText(String(d.getDate()));
      if (isToday) dateNum.addClass('hc-cal-date-num--today');

      // Type-colored pills — display only, no individual click listeners
      const maxPills = 3;
      const shown = items.slice(0, maxPills);
      const extra = items.length - maxPills;

      for (const item of shown) {
        const style = getCalItemStyle(item);
        const overdue = this._isCalItemOverdue(item);
        const done    = this._isCalItemDone(item);
        let pillCls = 'hc-cal-pill';
        if (item.kind === 'lecture') pillCls += ' hc-cal-pill--lecture';
        const pill = cell.createDiv(pillCls);
        if (done) {
          pill.style.background = 'var(--background-modifier-border)';
          pill.style.color = 'var(--text-muted)';
          pill.style.textDecoration = 'line-through';
        } else {
          pill.style.background = style.bg;
          pill.style.color = overdue ? '#E24B4A' : style.color;
        }
        pill.setText(calItemDisplayTitle(item));
      }

      if (extra > 0) {
        cell.createDiv({ cls: 'hc-cal-more', text: `+${extra} more` });
      }
    }
  }

  _renderWeekGrid(content, sem) {
    const todayISO = getTodayISO();
    const SHORT_DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

    const grid = content.createDiv('hc-cal-grid hc-cal-grid--week');

    // Header row
    for (let i = 0; i < 7; i++) {
      const dateISO = addDaysISO(this.calWeekStart, i);
      const d = new Date(dateISO + 'T12:00:00');
      const isToday = dateISO === todayISO;
      const hdr = grid.createDiv('hc-cal-week-header');
      if (isToday) hdr.addClass('hc-cal-week-header--today');
      hdr.createDiv({ cls: 'hc-cal-week-header-day',  text: SHORT_DAYS[i] });
      hdr.createDiv({ cls: 'hc-cal-week-header-date', text: String(d.getDate()) });
    }

    // Content row — cell click → popover (Option B)
    for (let i = 0; i < 7; i++) {
      const dateISO = addDaysISO(this.calWeekStart, i);
      const isToday = dateISO === todayISO;
      const items   = this._applyCalKindFilter(getItemsForDate(sem, dateISO, this.calFilterClassId));

      const cell = grid.createDiv('hc-cal-week-cell');
      if (isToday) cell.addClass('hc-cal-week-cell--today');
      if (items.length > 0) {
        cell.addClass('hc-cal-week-cell--has-items');
        cell.addEventListener('click', () => this._showCalPopover(items, cell, dateISO));
      }

      for (const item of items) {
        const style = getCalItemStyle(item);
        const overdue = this._isCalItemOverdue(item);
        const done    = this._isCalItemDone(item);
        let weekPillCls = 'hc-cal-week-pill';
        if (item.kind === 'lecture') weekPillCls += ' hc-cal-week-pill--lecture';
        const pill = cell.createDiv(weekPillCls);
        if (done) {
          pill.style.background = 'var(--background-modifier-border)';
          pill.style.color = 'var(--text-muted)';
          pill.style.textDecoration = 'line-through';
        } else {
          pill.style.background = style.bg;
          pill.style.color = overdue ? '#E24B4A' : style.color;
        }
        pill.setText(calItemDisplayTitle(item));
      }
    }
  }

  _renderCalFilterBar(content, sem) {
    const classes = sem.classes || [];

    const bar = content.createDiv('hc-cal-filter-bar');
    bar.createDiv({ cls: 'hc-cal-filter-label', text: 'Class' });

    const filterWrap = bar.createDiv('hc-cal-filter-wrap');
    const filterBtn  = filterWrap.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const filterIcon = filterBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(filterIcon, 'filter');
    const label = this.calFilterClassId
      ? (classes.find(c => c.id === this.calFilterClassId)?.code || 'All classes')
      : 'All classes';
    filterBtn.createSpan({ text: label });
    const chevron = filterBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(chevron, 'chevron-down');

    let dropEl = null;
    const closeDrop = () => { if (dropEl) { dropEl.remove(); dropEl = null; } };

    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropEl) { closeDrop(); return; }
      dropEl = filterWrap.createDiv('hc-sem-drop hc-cal-filter-drop');

      const allItem = dropEl.createDiv('hc-sem-drop-item');
      if (!this.calFilterClassId) allItem.addClass('hc-sem-drop-item--active');
      const allIcon = allItem.createSpan({ cls: 'hc-sem-drop-icon' });
      if (!this.calFilterClassId) setIcon(allIcon, 'check');
      allItem.createSpan({ text: 'All classes' });
      allItem.addEventListener('click', () => { this.calFilterClassId = null; closeDrop(); this.render(); });

      dropEl.createDiv('hc-sem-drop-divider');

      for (const cls of classes) {
        const item = dropEl.createDiv('hc-sem-drop-item');
        if (cls.id === this.calFilterClassId) item.addClass('hc-sem-drop-item--active');
        const icon = item.createSpan({ cls: 'hc-sem-drop-icon' });
        if (cls.id === this.calFilterClassId) setIcon(icon, 'check');
        const lbl = item.createSpan({ text: cls.code });
        lbl.style.color = accentText(getColor(cls.colorIndex));
        item.addEventListener('click', () => { this.calFilterClassId = cls.id; closeDrop(); this.render(); });
      }

      setTimeout(() => document.addEventListener('click', () => closeDrop(), { once: true }), 0);
    });

    // Show (kind) dropdown — mirrors the Class dropdown's shape.
    bar.createDiv({ cls: 'hc-cal-filter-label', text: 'Show' });

    const kindWrap = bar.createDiv('hc-cal-filter-wrap');
    const kindBtn  = kindWrap.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const kindIcon = kindBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(kindIcon, 'eye');
    const kindOpt = CAL_KIND_OPTIONS.find(o => o.value === this.calFilterKind);
    kindBtn.createSpan({ text: kindOpt ? kindOpt.label : 'All' });
    const kindChevron = kindBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(kindChevron, 'chevron-down');

    let kindDropEl = null;
    const closeKindDrop = () => { if (kindDropEl) { kindDropEl.remove(); kindDropEl = null; } };

    kindBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (kindDropEl) { closeKindDrop(); return; }
      kindDropEl = kindWrap.createDiv('hc-sem-drop hc-cal-filter-drop');

      for (const opt of CAL_KIND_OPTIONS) {
        const item = kindDropEl.createDiv('hc-sem-drop-item');
        if (opt.value === this.calFilterKind) item.addClass('hc-sem-drop-item--active');
        const icon = item.createSpan({ cls: 'hc-sem-drop-icon' });
        if (opt.value === this.calFilterKind) setIcon(icon, 'check');
        item.createSpan({ text: opt.label });
        item.addEventListener('click', () => {
          this.calFilterKind = opt.value;
          // Type only means something when narrowed to Assignments — clear it
          // rather than leave a stale, invisible filter in effect.
          if (opt.value !== 'assignment') this.calFilterType = null;
          closeKindDrop();
          this.render();
        });
      }

      setTimeout(() => document.addEventListener('click', () => closeKindDrop(), { once: true }), 0);
    });

    // Type (assignment subtype) dropdown — drawn only when Show is narrowed
    // to Assignments, since it can do nothing otherwise. Same rule the
    // plugin already applies to "Show removed semesters."
    if (this.calFilterKind === 'assignment') {
      bar.createDiv({ cls: 'hc-cal-filter-label', text: 'Type' });

      const typeWrap = bar.createDiv('hc-cal-filter-wrap');
      const typeBtn  = typeWrap.createEl('button', { cls: 'hc-btn hc-btn--sm' });
      const typeIcon = typeBtn.createSpan({ cls: 'hc-btn-icon' });
      setIcon(typeIcon, 'tag');
      typeBtn.createSpan({ text: this.calFilterType || 'All types' });
      const typeChevron = typeBtn.createSpan({ cls: 'hc-btn-icon' });
      setIcon(typeChevron, 'chevron-down');

      let typeDropEl = null;
      const closeTypeDrop = () => { if (typeDropEl) { typeDropEl.remove(); typeDropEl = null; } };

      typeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeDropEl) { closeTypeDrop(); return; }
        typeDropEl = typeWrap.createDiv('hc-sem-drop hc-cal-filter-drop');

        const allTypeItem = typeDropEl.createDiv('hc-sem-drop-item');
        if (!this.calFilterType) allTypeItem.addClass('hc-sem-drop-item--active');
        const allTypeIcon = allTypeItem.createSpan({ cls: 'hc-sem-drop-icon' });
        if (!this.calFilterType) setIcon(allTypeIcon, 'check');
        allTypeItem.createSpan({ text: 'All types' });
        allTypeItem.addEventListener('click', () => { this.calFilterType = null; closeTypeDrop(); this.render(); });

        typeDropEl.createDiv('hc-sem-drop-divider');

        for (const type of ASSIGNMENT_TYPES) {
          const typeStyle = getTypeStyle(type);
          const item = typeDropEl.createDiv('hc-sem-drop-item');
          if (type === this.calFilterType) item.addClass('hc-sem-drop-item--active');
          const icon = item.createSpan({ cls: 'hc-sem-drop-icon' });
          if (type === this.calFilterType) setIcon(icon, 'check');
          const lbl = item.createSpan({ text: type });
          lbl.style.color = typeText(typeStyle);
          item.addEventListener('click', () => { this.calFilterType = type; closeTypeDrop(); this.render(); });
        }

        setTimeout(() => document.addEventListener('click', () => closeTypeDrop(), { once: true }), 0);
      });
    }
  }

  // Applied at consumption, not inside getItemsForDate() — that function
  // stays shared with the Today sidebar, which does not get these filters.
  _applyCalKindFilter(items) {
    let filtered = items;
    if (this.calFilterKind) {
      filtered = filtered.filter(i => i.kind === this.calFilterKind);
    }
    if (this.calFilterKind === 'assignment' && this.calFilterType) {
      filtered = filtered.filter(i => i.assignment.type === this.calFilterType);
    }
    return filtered;
  }

  _isCalItemOverdue(item) {
    if (item.kind === 'lecture') return false;
    if (item.kind === 'assignment') {
      return item.assignment.dueDate
        && getDaysUntil(item.assignment.dueDate) < 0
        && item.assignment.status !== 'done';
    }
    if (item.kind === 'exam') {
      return item.exam.dueDate
        && getDaysUntil(item.exam.dueDate) < 0
        && item.exam.status !== 'done';
    }
    return false;
  }

  _isCalItemDone(item) {
    if (item.kind === 'lecture')    return item.lec.status === 'done';
    if (item.kind === 'assignment') return item.assignment.status === 'done';
    if (item.kind === 'exam')       return item.exam.status === 'done';
    return false;
  }

  _navigateCalItem(item) {
    if (item.kind === 'lecture')    this.navigate('lecture',    item.cls.id, item.lec.id);
    if (item.kind === 'assignment') this.navigate('assignment', item.cls.id, item.lectureId, item.assignment.id);
    if (item.kind === 'exam')       this.navigate('exam',       item.cls.id, null, null, item.exam.id);
  }

  _showCalPopover(items, cellEl, dateISO) {
    this._closeCalPopover();
    if (!items.length) return;

    const pop = document.body.createDiv('hc-cal-popover');
    this._calPopoverEl = pop;

    const rect = cellEl.getBoundingClientRect();
    const popW = 240;
    const left = (rect.right + popW + 8 < window.innerWidth)
      ? rect.right + 4
      : rect.left - popW - 4;
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - 320));
    pop.style.left = `${left}px`;
    pop.style.top  = `${top}px`;

    pop.createDiv({ cls: 'hc-cal-popover-date', text: formatDateLong(dateISO) });

    for (const item of items) {
      const style = getCalItemStyle(item);
      const overdue = this._isCalItemOverdue(item);
      const row = pop.createDiv('hc-cal-popover-item');
      if (overdue) row.addClass('hc-cal-popover-item--overdue');

      // Type-colored dot
      const dot = row.createDiv('hc-cal-popover-dot');
      dot.style.background = style.color;

      const info = row.createDiv('hc-cal-popover-info');
      const kindText = item.kind === 'lecture' ? 'Lecture'
        : item.kind === 'exam' ? 'Exam'
        : (item.assignment.type || 'Assignment');
      info.createSpan({ cls: 'hc-cal-popover-kind',  text: kindText });
      info.createDiv({  cls: 'hc-cal-popover-title', text: item.title });

      // §1.3 merged time — a lecture that matched its class's meeting schedule.
      if (item.kind === 'lecture' && item.meetingStartTime) {
        info.createDiv({ cls: 'hc-cal-popover-time', text: formatTimeRange(item.meetingStartTime, item.meetingEndTime) });
      }

      // Class code in muted text
      info.createDiv({ cls: 'hc-cal-popover-class', text: item.cls.code });

      row.addEventListener('click', () => {
        this._closeCalPopover();
        this._navigateCalItem(item);
      });
    }

    this._calPopoverCloseHandler = (e) => {
      if (!pop.contains(e.target)) this._closeCalPopover();
    };
    setTimeout(() => document.addEventListener('click', this._calPopoverCloseHandler, true), 0);
  }

  _closeCalPopover() {
    if (this._calPopoverEl) { this._calPopoverEl.remove(); this._calPopoverEl = null; }
    if (this._calPopoverCloseHandler) {
      document.removeEventListener('click', this._calPopoverCloseHandler, true);
      this._calPopoverCloseHandler = null;
    }
  }

  // ─── Dropdown cleanup ─────────────────────────────────────────────────────

  _closeSemDrop() {
    if (this._semDropEl) { this._semDropEl.remove(); this._semDropEl = null; }
    if (this._semCloseHandler) {
      document.removeEventListener('click', this._semCloseHandler, true);
      this._semCloseHandler = null;
    }
  }
}

// ─── Modals ───────────────────────────────────────────────────────────────────

class AddSemesterModal extends Modal {
  constructor(app, plugin, onSave) {
    super(app);
    this.plugin = plugin;
    this.onSave = onSave;
    this.name = '';
    this.term = '';
    this.year = '';
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'New semester' });

    let nameInput = null;

    new Setting(contentEl)
      .setName('Semester name')
      .setDesc('e.g. Fall 2025, Spring 2026')
      .addText(text => {
        nameInput = text.inputEl;
        text.setPlaceholder('Fall 2025').onChange(v => this.name = v);
        text.inputEl.focus();
        text.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') this._save(); });
      });

    // Fills an empty name field only. Never overwrites something you typed.
    const autofill = () => {
      if (!nameInput || nameInput.value.trim()) return;
      if (!this.term || !this.year.trim()) return;
      nameInput.value = `${this.term} ${this.year.trim()}`;
      this.name = nameInput.value;
    };

    _renderSemesterDateFields(contentEl, this, autofill);

    this._renderFooter(contentEl, 'Create semester', () => this._save());
  }

  _save() {
    if (!this.name.trim()) { new Notice('Semester name is required.'); return; }
    const year = _parseYearField(this.year);
    if (year === false) { new Notice('Year must be a 4-digit year between 1900 and 2199.'); return; }
    this.plugin.addSemester(this.name, this.term || null, year);
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

// Shared by both semester modals: term dropdown + year field, wired to
// `target.term` / `target.year`, with an optional autofill callback.
function _renderSemesterDateFields(contentEl, target, onChange) {
  new Setting(contentEl)
    .setName('Term')
    .setDesc('Optional. Sorts this semester in the Courses view.')
    .addDropdown(drop => {
      drop.addOption('', '—');
      for (const t of TERMS) drop.addOption(t, t);
      drop.setValue(target.term || '');
      drop.onChange(v => { target.term = v; if (onChange) onChange(); });
    });

  new Setting(contentEl)
    .setName('Year')
    .addText(text => {
      text.setPlaceholder('2026');
      text.setValue(target.year || '');
      text.onChange(v => { target.year = v; if (onChange) onChange(); });
    });
}

// '' -> null (cleared, valid). A bad value -> false, so the caller can tell
// "left blank" apart from "typed nonsense" and only complain about the latter.
function _parseYearField(raw) {
  const v = (raw || '').trim();
  if (!v) return null;
  if (!/^\d{4}$/.test(v)) return false;
  const n = parseInt(v, 10);
  if (n < 1900 || n > 2199) return false;
  return n;
}

class EditSemesterModal extends Modal {
  constructor(app, plugin, sem, onSave) {
    super(app);
    this.plugin = plugin;
    this.sem = sem;
    this.onSave = onSave;
    this.name = sem.name;
    this.term = sem.term || '';
    this.year = typeof sem.year === 'number' ? String(sem.year) : '';
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Edit semester' });

    let nameInput = null;

    new Setting(contentEl)
      .setName('Semester name')
      .addText(text => {
        nameInput = text.inputEl;
        text.setValue(this.sem.name).onChange(v => this.name = v);
        text.inputEl.focus();
        text.inputEl.select();
        text.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') this._save(); });
      });

    const autofill = () => {
      if (!nameInput || nameInput.value.trim()) return;
      if (!this.term || !this.year.trim()) return;
      nameInput.value = `${this.term} ${this.year.trim()}`;
      this.name = nameInput.value;
    };

    _renderSemesterDateFields(contentEl, this, autofill);

    this._renderFooter(contentEl, 'Save', () => this._save());
  }

  _save() {
    if (!this.name.trim()) { new Notice('Semester name is required.'); return; }
    const year = _parseYearField(this.year);
    if (year === false) { new Notice('Year must be a 4-digit year between 1900 and 2199.'); return; }
    this.plugin.updateSemester(this.sem.id, {
      name: this.name,
      term: this.term || null,
      year,
    });
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

// First-use explainer for removing a semester from the switcher. Shown once, then
// never again — the action is reversible, so a standing confirmation would be
// friction without a purpose.
class RemoveSemesterModal extends Modal {
  constructor(app, plugin, sem, onConfirm) {
    super(app);
    this.plugin = plugin;
    this.sem = sem;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Remove from list' });

    contentEl.createEl('p', {
      cls: 'hc-modal-body',
      text: `"${this.sem.name}" will stop appearing in the semester switcher. Nothing is deleted — its classes, lectures, assignments, exams, and library stay exactly as they are.`,
    });
    contentEl.createEl('p', {
      cls: 'hc-modal-body',
      text: 'You can still reach and edit its classes in Courses, and bring it back any time with "Show removed semesters" in the same dropdown.',
    });

    const footer = contentEl.createDiv('hc-modal-footer');
    const cancelBtn = footer.createEl('button', { cls: 'hc-btn', text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
    const okBtn = footer.createEl('button', { cls: 'hc-btn hc-btn--primary', text: 'Remove from list' });
    okBtn.addEventListener('click', () => {
      this.onConfirm();
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}

// The way back. Lists removed semesters; clicking one restores it and selects it.
class RemovedSemestersModal extends Modal {
  constructor(app, plugin, onChange) {
    super(app);
    this.plugin = plugin;
    this.onChange = onChange;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Removed semesters' });

    const removed = this.plugin.removedSemesters()
      .sort((a, b) => compareSemestersByTimeline(a, b, 1));
    if (!removed.length) {
      contentEl.createEl('p', { cls: 'hc-modal-body', text: 'No semesters have been removed.' });
      return;
    }

    contentEl.createEl('p', {
      cls: 'hc-modal-body',
      text: 'These are hidden from the switcher. Choose one to bring it back and switch to it.',
    });

    const list = contentEl.createDiv('hc-removed-list');
    for (const s of removed) {
      const row = list.createDiv('hc-removed-row');
      const info = row.createDiv('hc-removed-info');
      info.createDiv({ cls: 'hc-removed-name', text: s.name });
      const n = (s.classes || []).length;
      info.createDiv({ cls: 'hc-removed-meta', text: `${n} ${n === 1 ? 'class' : 'classes'}` });
      const restoreBtn = row.createEl('button', { cls: 'hc-btn', text: 'Restore' });
      restoreBtn.addEventListener('click', () => {
        this.plugin.restoreSemester(s.id);
        this.onChange();
        this.close();
      });
    }
  }

  onClose() { this.contentEl.empty(); }
}

class DeleteSemesterModal extends Modal {
  constructor(app, plugin, sem, onDelete) {
    super(app);
    this.plugin = plugin;
    this.sem = sem;
    this.onDelete = onDelete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Delete semester' });

    // Body count — say exactly what is about to be lost
    const classes = this.sem.classes || [];
    let lectures = 0, assignments = 0, exams = 0;
    for (const cls of classes) {
      lectures += (cls.lectures || []).length;
      assignments += (cls.assignments || []).length;
      for (const lec of (cls.lectures || [])) assignments += (lec.assignments || []).length;
      exams += (cls.exams || []).length;
    }
    const resources = (this.sem.resources || []).length;

    const count = (n, singular, pluralWord) => `${n} ${n === 1 ? singular : (pluralWord || singular + 's')}`;
    const parts = [
      count(classes.length, 'class', 'classes'),
      count(lectures, 'lecture'),
      count(assignments, 'assignment'),
      count(exams, 'exam'),
      count(resources, 'library resource'),
    ];

    contentEl.createEl('p', {
      cls: 'hc-modal-body',
      text: `Delete "${this.sem.name}" and everything in it: ${parts.join(', ')}. This cannot be undone.`,
    });

    const footer = contentEl.createDiv('hc-modal-footer');
    const cancelBtn = footer.createEl('button', { cls: 'hc-btn', text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
    const deleteBtn = footer.createEl('button', { cls: 'hc-btn hc-btn--danger', text: 'Delete semester' });
    deleteBtn.addEventListener('click', () => {
      this.plugin.deleteSemester(this.sem.id);
      this.onDelete();
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}

// Shared by AddClassModal and EditClassModal. Date range is required once a
// time is set — this ties the §1.3 synthesis feature's correctness to
// itself, not to a semester-level date range that doesn't exist, and
// prevents a finished short module from meeting forever. Returns an error
// string, or null if valid.
function validateClassSchedule(formData) {
  const { startDate, endDate, meetingStartTime, meetingEndTime } = formData;
  const anyTimeSet = !!(meetingStartTime || meetingEndTime);
  if (anyTimeSet) {
    if (!meetingStartTime || !meetingEndTime) {
      return 'Both start and end time are required together.';
    }
    if (meetingEndTime <= meetingStartTime) {
      return 'End time must be after start time.';
    }
    if (!startDate || !endDate) {
      return 'Start and end date are required once meeting times are set.';
    }
  }
  if (startDate && endDate && endDate < startDate) {
    return 'End date must be after start date.';
  }
  return null;
}

const CLASS_MODAL_TABS = ['Details', 'People', 'Schedule'];

class AddClassModal extends Modal {
  constructor(app, plugin, semesterId, onSave) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.onSave = onSave;
    this.currentTab = 'Details';
    this.formData = {
      name: '', code: '', courseUrl: '', meetingLink: '',
      professorName: '', professorEmail: '', officeHours: '',
      taName: '', taEmail: '', taOfficeHours: '',
      meetingDays: [],
      location: '', startDate: '', endDate: '', meetingStartTime: '', meetingEndTime: '',
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.addClass('hc-class-modal');
    this.modalEl.addClass('hc-class-modal-frame');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Add class' });

    const tabRow = contentEl.createDiv('hc-tab-row');
    const fieldsEl = contentEl.createDiv('hc-class-modal-fields');

    const renderTabs = () => {
      tabRow.empty();
      for (const tab of CLASS_MODAL_TABS) {
        const btn = tabRow.createEl('button', { cls: 'hc-tab', text: tab });
        if (tab === this.currentTab) btn.addClass('hc-tab--active');
        btn.addEventListener('click', () => {
          this.currentTab = tab;
          renderTabs();
          renderFields();
        });
      }
    };

    const renderFields = () => {
      fieldsEl.empty();
      if (this.currentTab === 'Details')       this._renderDetailsFields(fieldsEl);
      else if (this.currentTab === 'People')   this._renderPeopleFields(fieldsEl);
      else                                     this._renderScheduleFields(fieldsEl);
    };

    renderTabs();
    renderFields();

    this._renderFooter(contentEl, 'Add class', () => this._save());
  }

  // Every field carries setValue(formData.x) alongside its placeholder —
  // fields are torn down and rebuilt on every tab switch, so without this
  // anything typed on a tab you've left would look erased, even though
  // formData still has it.
  _renderDetailsFields(contentEl) {
    new Setting(contentEl).setName('Class name').addText(text => {
      text.setPlaceholder('Introduction to the Old Testament').setValue(this.formData.name).onChange(v => this.formData.name = v);
      text.inputEl.focus();
    });

    new Setting(contentEl).setName('Class code').addText(text => {
      text.setPlaceholder('RLST 145').setValue(this.formData.code).onChange(v => this.formData.code = v);
    });

    new Setting(contentEl).setName('Course page URL').addText(text => {
      text.setPlaceholder('https://www.coursera.org/learn/...').setValue(this.formData.courseUrl).onChange(v => this.formData.courseUrl = v);
      text.inputEl.type = 'url';
    });
  }

  _renderPeopleFields(contentEl) {
    new Setting(contentEl).setName('Professor name').addText(text => {
      text.setPlaceholder('Dr. Sarah Cohen').setValue(this.formData.professorName).onChange(v => this.formData.professorName = v);
    });

    new Setting(contentEl).setName('Professor email').addText(text => {
      text.setPlaceholder('cohen@university.edu').setValue(this.formData.professorEmail).onChange(v => this.formData.professorEmail = v);
      text.inputEl.type = 'email';
    });

    new Setting(contentEl).setName('Office hours').addText(text => {
      text.setPlaceholder('Wed 2–4 PM (Room 214)').setValue(this.formData.officeHours).onChange(v => this.formData.officeHours = v);
    });

    new Setting(contentEl).setName('TA name').addText(text => {
      text.setPlaceholder('Daniel Reyes').setValue(this.formData.taName).onChange(v => this.formData.taName = v);
    });

    new Setting(contentEl).setName('TA email').addText(text => {
      text.setPlaceholder('reyes@university.edu').setValue(this.formData.taEmail).onChange(v => this.formData.taEmail = v);
      text.inputEl.type = 'email';
    });

    new Setting(contentEl).setName('TA office hours').addText(text => {
      text.setPlaceholder('Mon 10–11 AM (Room 108)').setValue(this.formData.taOfficeHours).onChange(v => this.formData.taOfficeHours = v);
    });
  }

  _renderScheduleFields(contentEl) {
    this._renderDaysPicker(contentEl);

    new Setting(contentEl).setName('Location').addText(text => {
      text.setPlaceholder('Room 214 or Zoom').setValue(this.formData.location).onChange(v => this.formData.location = v);
    });

    new Setting(contentEl).setName('Start date').addText(text => {
      text.inputEl.type = 'date';
      text.setValue(this.formData.startDate).onChange(v => this.formData.startDate = v);
    });

    new Setting(contentEl).setName('End date').addText(text => {
      text.inputEl.type = 'date';
      text.setValue(this.formData.endDate).onChange(v => this.formData.endDate = v);
    });

    renderTimePicker(contentEl, 'Start time', this.formData.meetingStartTime, v => this.formData.meetingStartTime = v);
    renderTimePicker(contentEl, 'End time', this.formData.meetingEndTime, v => this.formData.meetingEndTime = v);

    new Setting(contentEl).setName('Meeting link').addText(text => {
      text.setPlaceholder('https://zoom.us/j/...').setValue(this.formData.meetingLink).onChange(v => this.formData.meetingLink = v);
      text.inputEl.type = 'url';
    });
  }

  _renderDaysPicker(contentEl) {
    const setting = new Setting(contentEl).setName('Meeting days');
    const picker = setting.controlEl.createDiv('hc-days-picker');
    for (const day of DAYS) {
      const chip = picker.createEl('button', { cls: 'hc-day-toggle', text: day, type: 'button' });
      if (this.formData.meetingDays.includes(day)) chip.addClass('hc-day-toggle--active');
      chip.addEventListener('click', () => {
        const idx = this.formData.meetingDays.indexOf(day);
        if (idx === -1) { this.formData.meetingDays.push(day); chip.addClass('hc-day-toggle--active'); }
        else { this.formData.meetingDays.splice(idx, 1); chip.removeClass('hc-day-toggle--active'); }
      });
    }
  }

  _save() {
    if (!this.formData.name.trim()) { new Notice('Class name is required.'); return; }
    const scheduleError = validateClassSchedule(this.formData);
    if (scheduleError) { new Notice(scheduleError); return; }
    this.plugin.addClass(this.semesterId, this.formData);
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

class EditClassModal extends Modal {
  constructor(app, plugin, semesterId, cls, onSave) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.cls = cls;
    this.onSave = onSave;
    this.currentTab = 'Details';
    this.formData = {
      name: cls.name || '',
      code: cls.code || '',
      courseUrl: cls.courseUrl || '',
      meetingLink: cls.meetingLink || '',
      professorName: cls.professorName || '',
      professorEmail: cls.professorEmail || '',
      officeHours: cls.officeHours || '',
      taName: cls.taName || '',
      taEmail: cls.taEmail || '',
      taOfficeHours: cls.taOfficeHours || '',
      meetingDays: [...(cls.meetingDays || [])],
      location: cls.location || '',
      startDate: cls.startDate || '',
      endDate: cls.endDate || '',
      meetingStartTime: cls.meetingStartTime || '',
      meetingEndTime: cls.meetingEndTime || '',
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.addClass('hc-class-modal');
    this.modalEl.addClass('hc-class-modal-frame');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Edit class' });

    const tabRow = contentEl.createDiv('hc-tab-row');
    const fieldsEl = contentEl.createDiv('hc-class-modal-fields');

    const renderTabs = () => {
      tabRow.empty();
      for (const tab of CLASS_MODAL_TABS) {
        const btn = tabRow.createEl('button', { cls: 'hc-tab', text: tab });
        if (tab === this.currentTab) btn.addClass('hc-tab--active');
        btn.addEventListener('click', () => {
          this.currentTab = tab;
          renderTabs();
          renderFields();
        });
      }
    };

    const renderFields = () => {
      fieldsEl.empty();
      if (this.currentTab === 'Details')       this._renderDetailsFields(fieldsEl);
      else if (this.currentTab === 'People')   this._renderPeopleFields(fieldsEl);
      else                                     this._renderScheduleFields(fieldsEl);
    };

    renderTabs();
    renderFields();

    this._renderFooter(contentEl, 'Save changes', () => this._save());
  }

  _renderDetailsFields(contentEl) {
    new Setting(contentEl).setName('Class name').addText(text => {
      text.setValue(this.formData.name).onChange(v => this.formData.name = v);
      text.inputEl.focus();
    });

    new Setting(contentEl).setName('Class code').addText(text => {
      text.setValue(this.formData.code).onChange(v => this.formData.code = v);
    });

    new Setting(contentEl).setName('Course page URL').addText(text => {
      text.setValue(this.formData.courseUrl).onChange(v => this.formData.courseUrl = v);
      text.inputEl.type = 'url';
    });
  }

  _renderPeopleFields(contentEl) {
    new Setting(contentEl).setName('Professor name').addText(text => {
      text.setValue(this.formData.professorName).onChange(v => this.formData.professorName = v);
    });

    new Setting(contentEl).setName('Professor email').addText(text => {
      text.setValue(this.formData.professorEmail).onChange(v => this.formData.professorEmail = v);
      text.inputEl.type = 'email';
    });

    new Setting(contentEl).setName('Office hours').addText(text => {
      text.setValue(this.formData.officeHours).onChange(v => this.formData.officeHours = v);
    });

    new Setting(contentEl).setName('TA name').addText(text => {
      text.setValue(this.formData.taName).onChange(v => this.formData.taName = v);
    });

    new Setting(contentEl).setName('TA email').addText(text => {
      text.setValue(this.formData.taEmail).onChange(v => this.formData.taEmail = v);
      text.inputEl.type = 'email';
    });

    new Setting(contentEl).setName('TA office hours').addText(text => {
      text.setValue(this.formData.taOfficeHours).onChange(v => this.formData.taOfficeHours = v);
    });
  }

  _renderScheduleFields(contentEl) {
    this._renderDaysPicker(contentEl);

    new Setting(contentEl).setName('Location').addText(text => {
      text.setValue(this.formData.location).onChange(v => this.formData.location = v);
    });

    new Setting(contentEl).setName('Start date').addText(text => {
      text.inputEl.type = 'date';
      text.setValue(this.formData.startDate).onChange(v => this.formData.startDate = v);
    });

    new Setting(contentEl).setName('End date').addText(text => {
      text.inputEl.type = 'date';
      text.setValue(this.formData.endDate).onChange(v => this.formData.endDate = v);
    });

    renderTimePicker(contentEl, 'Start time', this.formData.meetingStartTime, v => this.formData.meetingStartTime = v);
    renderTimePicker(contentEl, 'End time', this.formData.meetingEndTime, v => this.formData.meetingEndTime = v);

    new Setting(contentEl).setName('Meeting link').addText(text => {
      text.setValue(this.formData.meetingLink).onChange(v => this.formData.meetingLink = v);
      text.inputEl.type = 'url';
    });
  }

  _renderDaysPicker(contentEl) {
    const setting = new Setting(contentEl).setName('Meeting days');
    const picker = setting.controlEl.createDiv('hc-days-picker');
    for (const day of DAYS) {
      const chip = picker.createEl('button', { cls: 'hc-day-toggle', text: day, type: 'button' });
      if (this.formData.meetingDays.includes(day)) chip.addClass('hc-day-toggle--active');
      chip.addEventListener('click', () => {
        const idx = this.formData.meetingDays.indexOf(day);
        if (idx === -1) { this.formData.meetingDays.push(day); chip.addClass('hc-day-toggle--active'); }
        else { this.formData.meetingDays.splice(idx, 1); chip.removeClass('hc-day-toggle--active'); }
      });
    }
  }

  _save() {
    if (!this.formData.name.trim()) { new Notice('Class name is required.'); return; }
    const scheduleError = validateClassSchedule(this.formData);
    if (scheduleError) { new Notice(scheduleError); return; }
    this.plugin.updateClass(this.semesterId, this.cls.id, {
      name: this.formData.name.trim(),
      code: this.formData.code.trim(),
      courseUrl: this.formData.courseUrl.trim(),
      meetingLink: this.formData.meetingLink.trim(),
      professorName: this.formData.professorName.trim(),
      professorEmail: this.formData.professorEmail.trim(),
      officeHours: this.formData.officeHours.trim(),
      taName: this.formData.taName.trim(),
      taEmail: this.formData.taEmail.trim(),
      taOfficeHours: this.formData.taOfficeHours.trim(),
      meetingDays: this.formData.meetingDays,
      location: this.formData.location.trim(),
      startDate: this.formData.startDate,
      endDate: this.formData.endDate,
      meetingStartTime: this.formData.meetingStartTime,
      meetingEndTime: this.formData.meetingEndTime,
    });
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

// Moves a class into another semester. Names what travels before it happens —
// the class carries its own lectures/assignments/exams, but resources need
// explaining because they live on the semester, not the class.
class MoveClassModal extends Modal {
  constructor(app, plugin, sourceSemesterId, cls, onMove) {
    super(app);
    this.plugin = plugin;
    this.sourceSemesterId = sourceSemesterId;
    this.cls = cls;
    this.onMove = onMove;
    this.targetId = null;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Move class' });

    const targets = this.plugin.moveTargetsFor(this.sourceSemesterId);
    if (!targets.length) {
      contentEl.createEl('p', {
        cls: 'hc-modal-body',
        text: 'There is no other semester to move this class into. Create one first.',
      });
      return;
    }

    // What actually travels — counted, not promised in the abstract.
    const lectures = (this.cls.lectures || []).length;
    const assignments = this.plugin._allClassAssignments(this.cls).length;
    const exams = (this.cls.exams || []).length;
    const n = (v, s, p) => `${v} ${v === 1 ? s : (p || s + 's')}`;
    contentEl.createEl('p', {
      cls: 'hc-modal-body',
      text: `"${this.cls.code} — ${this.cls.name}" moves with ${n(lectures, 'lecture')}, ${n(assignments, 'assignment')}, and ${n(exams, 'exam')}. Nothing is deleted.`,
    });

    const targetOptions = {};
    for (const s of targets) targetOptions[s.id] = s.name;
    this.targetId = targets[0].id;
    new Setting(contentEl).setName('Move to').addDropdown(dd => {
      dd.addOptions(targetOptions);
      dd.setValue(this.targetId);
      dd.onChange(v => { this.targetId = v; });
    });

    contentEl.createEl('p', {
      cls: 'hc-modal-body',
      text: 'Library resources used only by this class move with it. Any shared with a class staying behind are copied, so neither side loses a book.',
    });

    const footer = contentEl.createDiv('hc-modal-footer');
    const cancelBtn = footer.createEl('button', { cls: 'hc-btn', text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
    const moveBtn = footer.createEl('button', { cls: 'hc-btn hc-btn--primary', text: 'Move class' });
    moveBtn.addEventListener('click', () => {
      const target = this.plugin.data.semesters.find(s => s.id === this.targetId);
      if (this.plugin.moveClass(this.sourceSemesterId, this.targetId, this.cls.id)) {
        this.onMove();
        new Notice(`"${this.cls.code}" moved to ${target ? target.name : 'the selected semester'}.`);
      }
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}

class DeleteClassModal extends Modal {
  constructor(app, plugin, semesterId, cls, onDelete) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.cls = cls;
    this.onDelete = onDelete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Delete class' });
    contentEl.createEl('p', {
      cls: 'hc-modal-body',
      text: `Delete "${this.cls.code} — ${this.cls.name}"? All lectures, assignments, exams, and resources for this class will be removed. This cannot be undone.`,
    });

    const footer = contentEl.createDiv('hc-modal-footer');
    const cancelBtn = footer.createEl('button', { cls: 'hc-btn', text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
    const deleteBtn = footer.createEl('button', { cls: 'hc-btn hc-btn--danger', text: 'Delete class' });
    deleteBtn.addEventListener('click', () => {
      this.plugin.deleteClass(this.semesterId, this.cls.id);
      this.onDelete();
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}

// ─── Shared modal footer helper ───────────────────────────────────────────────
// Attached to modal prototypes that share this pattern

function _makeDraggable(modal) {
  const el = modal.modalEl;
  el.style.position = 'fixed';
  let isDragging = false, dragOffX = 0, dragOffY = 0;

  const onMouseMove = e => {
    if (!isDragging) return;
    el.style.left      = (e.clientX - dragOffX) + 'px';
    el.style.top       = (e.clientY - dragOffY) + 'px';
    el.style.transform = 'none';
    el.style.margin    = '0';
  };
  const onMouseUp = () => {
    isDragging = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
  };

  const dragBar = modal.contentEl.createDiv('hc-drag-bar');
  dragBar.createSpan({ cls: 'hc-drag-bar-dots' });
  dragBar.createSpan({ cls: 'hc-drag-bar-label', text: 'drag to move' });

  dragBar.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (!el.style.left) {
      const rect = el.getBoundingClientRect();
      el.style.left      = rect.left + 'px';
      el.style.top       = rect.top  + 'px';
      el.style.transform = 'none';
      el.style.margin    = '0';
    }
    isDragging = true;
    dragOffX = e.clientX - el.getBoundingClientRect().left;
    dragOffY = e.clientY - el.getBoundingClientRect().top;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
    e.preventDefault();
  });
}

function _renderFooter(contentEl, saveLabel, onSave) {
  const footer = contentEl.createDiv('hc-modal-footer');
  const cancelBtn = footer.createEl('button', { cls: 'hc-btn', text: 'Cancel' });
  cancelBtn.addEventListener('click', () => this.close());
  const saveBtn = footer.createEl('button', { cls: 'hc-btn hc-btn--primary', text: saveLabel });
  saveBtn.addEventListener('click', onSave);
}

class AddLectureModal extends Modal {
  constructor(app, plugin, semesterId, classId, onSave) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.classId = classId;
    this.onSave = onSave;
    this.formData = { title: '', date: '' };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Add lecture' });

    new Setting(contentEl).setName('Title').addText(text => {
      text.setPlaceholder('Introduction & Canon Formation').onChange(v => this.formData.title = v);
      text.inputEl.focus();
      text.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') this._save(); });
    });

    const cls = this.plugin.findClass(this.semesterId, this.classId);
    const existingSorted = cls ? getLecturesSorted(cls) : [];
    const totalExisting = existingSorted.length;

    const warning = contentEl.createDiv('hc-lecture-reorder-warning');
    warning.style.display = 'none';

    new Setting(contentEl).setName('Date').addText(text => {
      text.inputEl.type = 'date';
      const checkPosition = (v) => {
        this.formData.date = v;
        if (!cls || !v || totalExisting === 0) { warning.style.display = 'none'; return; }
        // Simulate where this new lecture would land
        const simulated = [...existingSorted, { date: v, _new: true }].sort((a, b) => {
          if (!a.date && !b.date) return 0;
          if (!a.date) return 1;
          if (!b.date) return -1;
          return a.date.localeCompare(b.date);
        });
        const insertedPos = simulated.findIndex(l => l._new) + 1;
        if (insertedPos !== totalExisting + 1) {
          warning.setText(`⚠ This date inserts the lecture at position ${insertedPos} of ${totalExisting + 1}. Existing lecture numbers will update on save.`);
          warning.style.display = 'block';
        } else {
          warning.style.display = 'none';
        }
      };
      text.inputEl.addEventListener('input', e => checkPosition(e.target.value));
      text.inputEl.addEventListener('change', e => checkPosition(e.target.value));
    });

    this._renderFooter(contentEl, 'Add lecture', () => this._save());
  }

  _save() {
    if (!this.formData.title.trim()) { new Notice('Lecture title is required.'); return; }
    this.plugin.addLecture(this.semesterId, this.classId, this.formData);
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

class EditLectureModal extends Modal {
  constructor(app, plugin, semesterId, classId, lec, onSave) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.classId = classId;
    this.lec = lec;
    this.onSave = onSave;
    this.formData = { title: lec.title || '', date: lec.date || '' };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Edit lecture' });

    new Setting(contentEl).setName('Title').addText(text => {
      text.setValue(this.formData.title).onChange(v => this.formData.title = v);
      text.inputEl.focus();
      text.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') this._save(); });
    });

    const cls = this.plugin.findClass(this.semesterId, this.classId);
    const sorted = cls ? getLecturesSorted(cls) : [];
    const currentPos = sorted.findIndex(l => l.id === this.lec.id) + 1;

    // Warning shown when new date would shift the lecture's position
    const warning = contentEl.createDiv('hc-lecture-reorder-warning');
    warning.style.display = 'none';

    new Setting(contentEl).setName('Date').addText(text => {
      text.inputEl.type = 'date';
      text.inputEl.value = this.formData.date;
      const checkReorder = (v) => {
        this.formData.date = v;
        if (!cls || !v) { warning.style.display = 'none'; return; }
        const simulated = [...(cls.lectures || [])].map(l =>
          l.id === this.lec.id ? { ...l, date: v } : l
        ).sort((a, b) => {
          if (!a.date && !b.date) return 0;
          if (!a.date) return 1;
          if (!b.date) return -1;
          return a.date.localeCompare(b.date);
        });
        const newPos = simulated.findIndex(l => l.id === this.lec.id) + 1;
        if (newPos !== currentPos) {
          warning.setText(`⚠ This date moves the lecture from position ${currentPos} to ${newPos}. All lecture numbers will update on save.`);
          warning.style.display = 'block';
        } else {
          warning.style.display = 'none';
        }
      };
      text.inputEl.addEventListener('input', e => checkReorder(e.target.value));
      text.inputEl.addEventListener('change', e => checkReorder(e.target.value));
    });

    this._renderFooter(contentEl, 'Save changes', () => this._save());
  }

  _save() {
    if (!this.formData.title.trim()) { new Notice('Lecture title is required.'); return; }
    this.plugin.updateLecture(this.semesterId, this.classId, this.lec.id, {
      title: this.formData.title.trim(),
      date: this.formData.date,
    });
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

class DeleteLectureModal extends Modal {
  constructor(app, plugin, semesterId, classId, lec, onDelete) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.classId = classId;
    this.lec = lec;
    this.onDelete = onDelete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Delete lecture' });
    contentEl.createEl('p', {
      cls: 'hc-modal-body',
      text: `Delete "${this.lec.title}"? All assignments attached to this lecture will also be removed. This cannot be undone.`,
    });

    const footer = contentEl.createDiv('hc-modal-footer');
    const cancelBtn = footer.createEl('button', { cls: 'hc-btn', text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
    const deleteBtn = footer.createEl('button', { cls: 'hc-btn hc-btn--danger', text: 'Delete lecture' });
    deleteBtn.addEventListener('click', () => {
      this.plugin.deleteLecture(this.semesterId, this.classId, this.lec.id);
      this.onDelete();
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}

class BulkAddLecturesModal extends Modal {
  constructor(app, plugin, semesterId, classId, onSave) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.classId = classId;
    this.onSave = onSave;
    this.text = '';
    this.startDate = '';
    const cls = plugin.findClass(semesterId, classId);
    this.meetingDays = [...((cls && cls.meetingDays) || [])];
    this.parsed = { rows: [], counts: { lectures: 0, dated: 0, undated: 0, skipped: 0 }, patternActive: false };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.addClass('hc-bulk-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Bulk add lectures' });

    contentEl.createDiv({
      cls: 'hc-bulk-hint',
      text: 'One lecture per line. A date at the end of a line (2026-08-24, Aug 24, or 8/24) is optional.',
    });

    this.textarea = contentEl.createEl('textarea', { cls: 'hc-bulk-textarea' });
    this.textarea.setAttribute('placeholder', 'Introduction & Canon Formation\nThe Pentateuch\nWisdom, Poetry, and Psalms');
    this.textarea.setAttribute('rows', '8');
    this.textarea.addEventListener('input', () => { this.text = this.textarea.value; this._refresh(); });

    new Setting(contentEl)
      .setName('Assign dates automatically')
      .setDesc('Pick the first day of class. Dates follow the meeting days below. A blank line between lectures skips one meeting (for breaks).')
      .addText(text => {
        text.inputEl.type = 'date';
        const onDate = (v) => { this.startDate = v; this._refresh(); };
        text.inputEl.addEventListener('input',  e => onDate(e.target.value));
        text.inputEl.addEventListener('change', e => onDate(e.target.value));
      });

    const daysSetting = new Setting(contentEl).setName('Meeting days');
    const picker = daysSetting.controlEl.createDiv('hc-days-picker');
    for (const day of DAYS) {
      const chip = picker.createEl('button', { cls: 'hc-day-toggle', text: day, type: 'button' });
      if (this.meetingDays.includes(day)) chip.addClass('hc-day-toggle--active');
      chip.addEventListener('click', () => {
        const idx = this.meetingDays.indexOf(day);
        if (idx === -1) { this.meetingDays.push(day); chip.addClass('hc-day-toggle--active'); }
        else { this.meetingDays.splice(idx, 1); chip.removeClass('hc-day-toggle--active'); }
        this._refresh();
      });
    }

    this.summaryEl = contentEl.createDiv('hc-bulk-summary');
    contentEl.createDiv({
      cls: 'hc-bulk-warning',
      text: 'Check every row before adding — a pasted line break can split one lecture into two, and this can\'t be undone in bulk. Short titles below are highlighted for a second look.',
    });
    this.previewEl = contentEl.createDiv('hc-bulk-preview');
    this.existingNote = contentEl.createDiv('hc-bulk-existing-note');

    const footer = contentEl.createDiv('hc-modal-footer');
    const cancelBtn = footer.createEl('button', { cls: 'hc-btn', text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
    this.saveBtn = footer.createEl('button', { cls: 'hc-btn hc-btn--primary', text: 'Add lectures' });
    this.saveBtn.addEventListener('click', () => this._save());

    this._refresh();
    this.textarea.focus();
  }

  _refresh() {
    this.parsed = parseBulkLectures(this.text, { startDate: this.startDate, meetingDays: this.meetingDays });
    const { rows, counts, patternActive } = this.parsed;

    this.summaryEl.empty();
    this.previewEl.empty();
    this.existingNote.empty();

    if (counts.lectures === 0) {
      this.summaryEl.setText(this.text.trim() ? 'No lectures found.' : 'Paste lectures above to preview.');
      this.saveBtn.setText('Add lectures');
      this.saveBtn.disabled = true;
      return;
    }

    const parts = [`${counts.lectures} lecture${counts.lectures === 1 ? '' : 's'}`];
    const detail = [];
    if (counts.dated) detail.push(`${counts.dated} dated`);
    if (counts.undated) detail.push(`${counts.undated} undated`);
    if (counts.skipped) detail.push(`${counts.skipped} skipped meeting${counts.skipped === 1 ? '' : 's'}`);
    if (detail.length) parts.push(detail.join(', '));
    this.summaryEl.setText(parts.join(' — '));

    for (const row of rows) {
      const el = this.previewEl.createDiv('hc-bulk-row');
      if (row.kind === 'skip') {
        el.addClass('hc-bulk-row--skip');
        el.createSpan({ cls: 'hc-bulk-row-title', text: '— skipped —' });
        el.createSpan({ cls: 'hc-bulk-row-date', text: formatDateWithDay(row.date) });
        continue;
      }
      if (row.shortTitle) el.addClass('hc-bulk-row--short');
      const titleEl = el.createSpan({ cls: 'hc-bulk-row-title', text: row.title });
      if (row.shortTitle) titleEl.setAttribute('title', 'Short title — check this isn\'t a split line from a longer title.');
      const dateEl = el.createSpan({ cls: 'hc-bulk-row-date', text: row.date ? formatDateWithDay(row.date) : 'No date' });
      if (!row.date) dateEl.addClass('hc-bulk-row-date--none');
    }

    const cls = this.plugin.findClass(this.semesterId, this.classId);
    const existing = (cls && cls.lectures || []).length;
    if (existing > 0) {
      this.existingNote.setText(`This class already has ${existing} lecture${existing === 1 ? '' : 's'}. New lectures sort by date among them; undated lectures keep this order at the end.`);
    }

    this.saveBtn.setText(`Add ${counts.lectures} lecture${counts.lectures === 1 ? '' : 's'}`);
    this.saveBtn.disabled = false;
  }

  _save() {
    const { rows, counts } = this.parsed;
    if (counts.lectures === 0) { new Notice('Nothing to add.'); return; }
    for (const row of rows) {
      if (row.kind !== 'lecture') continue;
      this.plugin.addLecture(this.semesterId, this.classId, { title: row.title, date: row.date });
    }
    new Notice(`Added ${counts.lectures} lecture${counts.lectures === 1 ? '' : 's'}.`);
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

class BulkAddAssignmentsModal extends Modal {
  constructor(app, plugin, semesterId, classId, lectureId, onSave) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.classId = classId;
    this.lectureId = lectureId;
    this.onSave = onSave;
    this.text = '';
    this.type = 'Reading';
    this.dueDate = '';
    this.parsed = { rows: [], counts: { assignments: 0 } };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.addClass('hc-bulk-modal');

    const cls = this.plugin.findClass(this.semesterId, this.classId);
    const lec = cls && (cls.lectures || []).find(l => l.id === this.lectureId);
    this.dueDate = (lec && lec.date) || '';

    const lecNumber = this._lectureNumber(cls);
    contentEl.createEl('h2', {
      cls: 'hc-modal-title',
      text: lecNumber ? `Bulk add assignments — Lecture ${lecNumber}` : 'Bulk add assignments',
    });

    contentEl.createDiv({
      cls: 'hc-bulk-hint',
      text: this.dueDate
        ? `One assignment per line. All are due ${formatDateWithDay(this.dueDate)} — this lecture's date.`
        : 'One assignment per line. This lecture has no date, so due dates are left blank.',
    });

    this.textarea = contentEl.createEl('textarea', { cls: 'hc-bulk-textarea' });
    this.textarea.setAttribute('placeholder', 'Introduction to Joshua (JSB pp. 462-464)\nJoshua 1-13, 20, 23-24\nIntroduction to Judges (JSB pp. 508-510)');
    this.textarea.setAttribute('rows', '8');
    this.textarea.addEventListener('input', () => { this.text = this.textarea.value; this._refresh(); });

    new Setting(contentEl).setName('Type').addDropdown(drop => {
      for (const t of ASSIGNMENT_TYPES) drop.addOption(t, t);
      drop.setValue(this.type);
      drop.onChange(v => { this.type = v; this._refresh(); });
    });

    this.summaryEl = contentEl.createDiv('hc-bulk-summary');
    contentEl.createDiv({
      cls: 'hc-bulk-warning',
      text: 'Check every row before adding — a pasted line break splits one assignment into two, and this can\'t be undone in bulk.',
    });
    this.previewEl = contentEl.createDiv('hc-bulk-preview');

    const footer = contentEl.createDiv('hc-modal-footer');
    const cancelBtn = footer.createEl('button', { cls: 'hc-btn', text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
    this.saveBtn = footer.createEl('button', { cls: 'hc-btn hc-btn--primary', text: 'Add assignments' });
    this.saveBtn.addEventListener('click', () => this._save());

    this._refresh();
    this.textarea.focus();
  }

  _lectureNumber(cls) {
    if (!cls) return null;
    const idx = getLecturesSorted(cls).findIndex(l => l.id === this.lectureId);
    return idx === -1 ? null : idx + 1;
  }

  _refresh() {
    this.parsed = parseBulkAssignments(this.text);
    const { rows, counts } = this.parsed;

    this.summaryEl.empty();
    this.previewEl.empty();

    if (counts.assignments === 0) {
      this.summaryEl.setText(this.text.trim() ? 'No assignments found.' : 'Paste assignments above to preview.');
      this.saveBtn.setText('Add assignments');
      this.saveBtn.disabled = true;
      return;
    }

    const plural = counts.assignments === 1 ? '' : 's';
    this.summaryEl.setText(this.dueDate
      ? `${counts.assignments} ${this.type} assignment${plural} — due ${formatDateWithDay(this.dueDate)}`
      : `${counts.assignments} ${this.type} assignment${plural} — no due date`);

    for (const row of rows) {
      const el = this.previewEl.createDiv('hc-bulk-row');
      el.createSpan({ cls: 'hc-bulk-row-title', text: row.title });
      const dateEl = el.createSpan({ cls: 'hc-bulk-row-date', text: this.dueDate ? formatDate(this.dueDate) : 'No date' });
      if (!this.dueDate) dateEl.addClass('hc-bulk-row-date--none');
    }

    this.saveBtn.setText(`Add ${counts.assignments} assignment${plural}`);
    this.saveBtn.disabled = false;
  }

  _save() {
    const { rows, counts } = this.parsed;
    if (counts.assignments === 0) { new Notice('Nothing to add.'); return; }
    for (const row of rows) {
      this.plugin.addAssignment(this.semesterId, this.classId, this.lectureId, {
        title: row.title,
        type: this.type,
        dueDate: this.dueDate,
      });
    }
    new Notice(`Added ${counts.assignments} assignment${counts.assignments === 1 ? '' : 's'}.`);
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

class AddAssignmentModal extends Modal {
  // #9: defaultType lets a call site steer the opening type — the Assignments
  // tab now passes 'Writing', since Reading no longer shows up in that list
  // once saved and would otherwise seem to vanish. Readings tab, lecture-detail
  // and the command palette are left on the original 'Reading' default.
  //
  // lockedType and excludeTypes fix the follow-on bug: a call site tied to one
  // specific tab shouldn't offer a Type choice that doesn't belong there. The
  // Readings tab passes lockedType 'Reading' — no dropdown at all, title reads
  // "Add reading". The Assignments tab passes excludeTypes ['Reading'] — the
  // dropdown stays, just without the option that would misfile the item.
  // Lecture-detail and the command palette pass neither, so they keep the
  // original full-choice picker (they aren't tied to a single tab).
  // (LiveAQuietLife, 2026-09-01)
  constructor(app, plugin, semesterId, cls, onSave, defaultLectureId = null, defaultType = 'Reading', lockedType = null, excludeTypes = []) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.cls = cls;
    this.onSave = onSave;
    this.lockedType = lockedType;
    this.excludeTypes = excludeTypes;
    let initialType = lockedType || defaultType;
    if (!lockedType && excludeTypes.includes(initialType)) {
      initialType = ASSIGNMENT_TYPES.find(t => !excludeTypes.includes(t)) || initialType;
    }
    this.formData = { title: '', type: initialType, dueDate: '', lectureId: defaultLectureId || null };
    // Pre-fill due date if opening from a lecture context
    if (defaultLectureId) {
      const lec = (cls.lectures || []).find(l => l.id === defaultLectureId);
      if (lec?.date) this.formData.dueDate = lec.date;
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    // #9: title tracks lockedType so a Readings-tab add doesn't say
    // "Add assignment". (LiveAQuietLife, 2026-09-01)
    const modalLabel = this.lockedType ? `Add ${this.lockedType.toLowerCase()}` : 'Add assignment';
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: modalLabel });

    new Setting(contentEl).setName('Title').addText(text => {
      text.setPlaceholder('Introduction to the OT, Ch. 1-3').onChange(v => this.formData.title = v);
      text.inputEl.focus();
    });

    if (this.lockedType) {
      // #9: this entry point only ever creates one type — no choice to make,
      // so no dropdown to make it with. (LiveAQuietLife, 2026-09-01)
      this.formData.type = this.lockedType;
    } else {
      new Setting(contentEl).setName('Type').addDropdown(drop => {
        for (const t of ASSIGNMENT_TYPES) {
          if (this.excludeTypes.includes(t)) continue;
          drop.addOption(t, t);
        }
        drop.setValue(this.formData.type);
        drop.onChange(v => { this.formData.type = v; this._updateConditional(contentEl); });
      });
    }

    // Lecture selector before due date so it can autofill
    let dueDateInputEl = null;
    new Setting(contentEl).setName('Lecture').addDropdown(drop => {
      drop.addOption('', 'Class-level (no lecture)');
      const sorted = getLecturesSorted(this.cls);
      sorted.forEach((lec, i) => drop.addOption(lec.id, `Lecture ${i + 1} — ${lec.title}`));
      drop.setValue(this.formData.lectureId || '');
      drop.onChange(v => {
        this.formData.lectureId = v || null;
        if (v && dueDateInputEl) {
          const lec = this.cls.lectures.find(l => l.id === v);
          if (lec?.date) {
            dueDateInputEl.value = lec.date;
            this.formData.dueDate = lec.date;
          }
        }
      });
    });

    new Setting(contentEl).setName('Due date').addText(text => {
      text.inputEl.type = 'date';
      text.inputEl.value = this.formData.dueDate;
      dueDateInputEl = text.inputEl;
      text.onChange(v => this.formData.dueDate = v);
    });

    // Conditional fields container
    contentEl.createDiv('hc-assign-conditional');
    this._updateConditional(contentEl);

    this._renderFooter(contentEl, modalLabel, () => this._save());
  }

  _updateConditional(contentEl) {
    const container = contentEl.querySelector('.hc-assign-conditional');
    if (!container) return;
    container.empty();
    if (this.formData.type === 'Reading') {
      const sem = this.plugin.data.semesters.find(s => s.id === this.semesterId);
      const classResources = sem ? (sem.resources || []).filter(r => (r.classIds || []).includes(this.cls.id)) : [];

      const setting = new Setting(container).setName('Linked book');
      setting.controlEl.addClass('hc-linked-book-control');
      setting.infoEl.addClass('hc-linked-book-info');
      const wrap = setting.controlEl.createDiv('hc-resource-picker-wrap');

      const label = wrap.createSpan({ cls: 'hc-resource-picker-label' });
      const clearBtn = wrap.createEl('button', { cls: 'hc-btn hc-btn--sm', text: 'Clear', type: 'button' });

      const updatePicker = () => {
        const res = classResources.find(r => r.id === this.formData.linkedBook);
        label.setText(res ? res.title : 'None selected');
        label.style.color = res ? 'var(--text-normal)' : 'var(--text-faint)';
        clearBtn.style.display = this.formData.linkedBook ? '' : 'none';
      };
      updatePicker();

      const selectBtn = wrap.createEl('button', { cls: 'hc-btn hc-btn--sm', text: 'Select', type: 'button' });
      selectBtn.addEventListener('click', () => {
        new ResourcePickSuggestModal(this.app, classResources, (resource) => {
          this.formData.linkedBook = resource.id;
          updatePicker();
        }, (titleHint) => {
          new QuickAddResourceModal(this.app, this.plugin, this.semesterId, this.cls.id, titleHint, (resource) => {
            classResources.push(resource);
            this.formData.linkedBook = resource.id;
            updatePicker();
          }).open();
        }).open();
      });

      clearBtn.addEventListener('click', () => {
        this.formData.linkedBook = '';
        updatePicker();
      });

    }
  }

  _save() {
    if (!this.formData.title.trim()) { new Notice('Assignment title is required.'); return; }
    const assign = this.plugin.addAssignment(this.semesterId, this.cls.id, this.formData.lectureId, this.formData);
    if (assign && this.formData.linkedBook) assign.linkedBook = this.formData.linkedBook;
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

class EditAssignmentModal extends Modal {
  constructor(app, plugin, semesterId, cls, assignment, onSave) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.cls = cls;
    this.assignment = assignment;
    this.onSave = onSave;
    this.formData = {
      title: assignment.title || '',
      type: assignment.type || 'Other',
      dueDate: assignment.dueDate || '',
      linkedBook: assignment.linkedBook || '',
      linkedNote: assignment.linkedNote || '',
    };
  }

  // #9: title tracks the item's Type — a Reading opens as "Edit reading",
  // not "Edit assignment" — and updates live if the Type dropdown changes,
  // same split as everywhere else since #9. (LiveAQuietLife, 2026-09-01)
  _modalLabel() {
    return this.formData.type === 'Reading' ? 'Edit reading' : 'Edit assignment';
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    const titleEl = contentEl.createEl('h2', { cls: 'hc-modal-title', text: this._modalLabel() });

    new Setting(contentEl).setName('Title').addText(text => {
      text.setValue(this.formData.title).onChange(v => this.formData.title = v);
      text.inputEl.focus();
    });

    new Setting(contentEl).setName('Type').addDropdown(drop => {
      for (const t of ASSIGNMENT_TYPES) drop.addOption(t, t);
      drop.setValue(this.formData.type);
      drop.onChange(v => {
        this.formData.type = v;
        titleEl.setText(this._modalLabel());
        this._updateConditional(contentEl);
      });
    });

    new Setting(contentEl).setName('Due date').addText(text => {
      text.inputEl.type = 'date';
      text.inputEl.value = this.formData.dueDate;
      text.onChange(v => this.formData.dueDate = v);
    });

    contentEl.createDiv('hc-assign-conditional');
    this._updateConditional(contentEl);

    this._renderFooter(contentEl, 'Save changes', () => this._save());
  }

  _updateConditional(contentEl) {
    const container = contentEl.querySelector('.hc-assign-conditional');
    if (!container) return;
    container.empty();
    if (this.formData.type === 'Reading') {
      const sem = this.plugin.data.semesters.find(s => s.id === this.semesterId);
      const classResources = sem ? (sem.resources || []).filter(r => (r.classIds || []).includes(this.cls.id)) : [];

      const setting = new Setting(container).setName('Linked book');
      setting.controlEl.addClass('hc-linked-book-control');
      setting.infoEl.addClass('hc-linked-book-info');
      const wrap = setting.controlEl.createDiv('hc-resource-picker-wrap');

      const label = wrap.createSpan({ cls: 'hc-resource-picker-label' });
      const clearBtn = wrap.createEl('button', { cls: 'hc-btn hc-btn--sm', text: 'Clear', type: 'button' });

      const updatePicker = () => {
        const res = classResources.find(r => r.id === this.formData.linkedBook);
        label.setText(res ? res.title : 'None selected');
        label.style.color = res ? 'var(--text-normal)' : 'var(--text-faint)';
        clearBtn.style.display = this.formData.linkedBook ? '' : 'none';
      };
      updatePicker();

      const selectBtn = wrap.createEl('button', { cls: 'hc-btn hc-btn--sm', text: 'Select', type: 'button' });
      selectBtn.addEventListener('click', () => {
        new ResourcePickSuggestModal(this.app, classResources, (resource) => {
          this.formData.linkedBook = resource.id;
          updatePicker();
        }, (titleHint) => {
          new QuickAddResourceModal(this.app, this.plugin, this.semesterId, this.cls.id, titleHint, (resource) => {
            classResources.push(resource);
            this.formData.linkedBook = resource.id;
            updatePicker();
          }).open();
        }).open();
      });

      clearBtn.addEventListener('click', () => {
        this.formData.linkedBook = '';
        updatePicker();
      });

    }
  }

  _save() {
    if (!this.formData.title.trim()) { new Notice('Assignment title is required.'); return; }
    this.plugin.updateAssignment(this.semesterId, this.cls.id, this.assignment.id, {
      title: this.formData.title.trim(),
      type: this.formData.type,
      dueDate: this.formData.dueDate,
      linkedBook: this.formData.type === 'Reading' ? this.formData.linkedBook : '',
      linkedNote: this.formData.linkedNote,
    });
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

class DeleteAssignmentModal extends Modal {
  constructor(app, plugin, semesterId, classId, assignment, onDelete) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.classId = classId;
    this.assignment = assignment;
    this.onDelete = onDelete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Delete assignment' });
    contentEl.createEl('p', {
      cls: 'hc-modal-body',
      text: `Delete "${this.assignment.title}"? This cannot be undone.`,
    });

    const footer = contentEl.createDiv('hc-modal-footer');
    const cancelBtn = footer.createEl('button', { cls: 'hc-btn', text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
    const deleteBtn = footer.createEl('button', { cls: 'hc-btn hc-btn--danger', text: 'Delete assignment' });
    deleteBtn.addEventListener('click', () => {
      this.plugin.deleteAssignment(this.semesterId, this.classId, this.assignment.id);
      this.onDelete();
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}

class MoveAssignmentModal extends Modal {
  constructor(app, plugin, semesterId, cls, assignment, currentLectureId, onSave) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.cls = cls;
    this.assignment = assignment;
    this.onSave = onSave;
    this.formData = { lectureId: currentLectureId, dueDate: assignment.dueDate || '' };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Move to lecture' });

    let dueDateInputEl = null;

    new Setting(contentEl).setName('Lecture').addDropdown(drop => {
      drop.addOption('', 'Class-level (no lecture)');
      const sorted = getLecturesSorted(this.cls);
      sorted.forEach((lec, i) => drop.addOption(lec.id, `Lecture ${i + 1} — ${lec.title}`));
      drop.setValue(this.formData.lectureId || '');
      drop.onChange(v => {
        this.formData.lectureId = v || null;
        if (dueDateInputEl) {
          if (v) {
            const lec = this.cls.lectures.find(l => l.id === v);
            if (lec?.date) {
              dueDateInputEl.value = lec.date;
              this.formData.dueDate = lec.date;
            }
          }
        }
      });
    });

    new Setting(contentEl).setName('Due date').addText(text => {
      text.inputEl.type = 'date';
      text.inputEl.value = this.formData.dueDate;
      dueDateInputEl = text.inputEl;
      text.onChange(v => this.formData.dueDate = v);
    });

    this._renderFooter(contentEl, 'Move', () => this._save());
  }

  _save() {
    this.assignment.dueDate = this.formData.dueDate;
    this.plugin.moveAssignment(this.semesterId, this.cls.id, this.assignment.id, this.formData.lectureId);
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

// ─── Exam modals ──────────────────────────────────────────────────────────────

class AddExamModal extends Modal {
  constructor(app, plugin, semesterId, cls, onSave) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.cls = cls;
    this.onSave = onSave;
    this.formData = { title: '', dueDate: '' };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Add exam' });

    new Setting(contentEl).setName('Title').addText(text => {
      text.setPlaceholder('e.g. Midterm Exam').onChange(v => this.formData.title = v);
      text.inputEl.focus();
    });

    new Setting(contentEl).setName('Due date').addText(text => {
      text.inputEl.type = 'date';
      text.inputEl.value = this.formData.dueDate;
      text.onChange(v => this.formData.dueDate = v);
    });

    this._renderFooter(contentEl, 'Add exam', () => this._save());
  }

  _save() {
    if (!this.formData.title.trim()) { new Notice('Exam title is required.'); return; }
    this.plugin.addExam(this.semesterId, this.cls.id, this.formData);
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

class EditExamModal extends Modal {
  constructor(app, plugin, semesterId, classId, exam, onSave) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.classId = classId;
    this.exam = exam;
    this.onSave = onSave;
    this.formData = {
      title: exam.title || '',
      dueDate: exam.dueDate || '',
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Edit exam' });

    new Setting(contentEl).setName('Title').addText(text => {
      text.setValue(this.formData.title).onChange(v => this.formData.title = v);
      text.inputEl.focus();
    });

    new Setting(contentEl).setName('Due date').addText(text => {
      text.inputEl.type = 'date';
      text.inputEl.value = this.formData.dueDate;
      text.onChange(v => this.formData.dueDate = v);
    });

    this._renderFooter(contentEl, 'Save changes', () => this._save());
  }

  _save() {
    if (!this.formData.title.trim()) { new Notice('Exam title is required.'); return; }
    this.plugin.updateExam(this.semesterId, this.classId, this.exam.id, {
      title: this.formData.title.trim(),
      dueDate: this.formData.dueDate,
    });
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

class DeleteExamModal extends Modal {
  constructor(app, plugin, semesterId, classId, exam, onDelete) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.classId = classId;
    this.exam = exam;
    this.onDelete = onDelete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Delete exam' });
    contentEl.createEl('p', {
      cls: 'hc-modal-body',
      text: `Delete "${this.exam.title}"? This cannot be undone.`,
    });

    const footer = contentEl.createDiv('hc-modal-footer');
    const cancelBtn = footer.createEl('button', { cls: 'hc-btn', text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
    const deleteBtn = footer.createEl('button', { cls: 'hc-btn hc-btn--danger', text: 'Delete exam' });
    deleteBtn.addEventListener('click', () => {
      this.plugin.deleteExam(this.semesterId, this.classId, this.exam.id);
      this.onDelete();
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}

// ─── Vault file suggester ─────────────────────────────────────────────────────

class VaultLinkSuggestModal extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder('Type to search vault files…');
  }

  getItems() {
    return this.app.vault.getFiles();
  }

  getItemText(file) {
    return file.path;
  }

  onChooseItem(file, evt) {
    this.onChoose(file.path);
  }
}

// ─── Resource picker suggester ───────────────────────────────────────────────

class ResourcePickSuggestModal extends FuzzySuggestModal {
  constructor(app, resources, onChoose, onQuickAdd) {
    super(app);
    this.resources = resources;
    this.onChoose = onChoose;
    this.onQuickAdd = onQuickAdd;
    this.setPlaceholder('Type to search library resources…');
  }

  onOpen() {
    super.onOpen();
    const footer = this.modalEl.createDiv('hc-suggest-footer');
    const addBtn = footer.createEl('button', { cls: 'hc-btn hc-btn--sm', text: '+ Quick add to Library' });
    addBtn.addEventListener('click', () => {
      const titleHint = this.inputEl?.value?.trim() || '';
      this.close();
      this.onQuickAdd(titleHint);
    });
  }

  getItems() { return this.resources; }

  getItemText(resource) {
    return resource.author ? `${resource.title} — ${resource.author}` : resource.title;
  }

  onChooseItem(resource) { this.onChoose(resource); }
}

// ─── Quick-add resource modal ─────────────────────────────────────────────────

class QuickAddResourceModal extends Modal {
  constructor(app, plugin, semesterId, classId, titleHint, onAdd) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.classId = classId;
    this.title = titleHint;
    this.onAdd = onAdd;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Quick add to Library' });
    contentEl.createDiv({
      cls: 'hc-modal-body',
      text: 'Creates a minimal resource tagged to this class. Add details in Library later.',
    });

    new Setting(contentEl).setName('Title').addText(text => {
      text.setValue(this.title).onChange(v => this.title = v);
      text.inputEl.focus();
      text.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') this._save(); });
    });

    const footer = contentEl.createDiv('hc-modal-footer');
    const cancelBtn = footer.createEl('button', { cls: 'hc-btn', text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
    const addBtn = footer.createEl('button', { cls: 'hc-btn hc-btn--primary', text: 'Add to Library' });
    addBtn.addEventListener('click', () => this._save());
  }

  _save() {
    if (!this.title.trim()) { new Notice('Title is required.'); return; }
    const resource = this.plugin.addResource(this.semesterId, {
      title: this.title.trim(),
      author: '',
      type: '',
      classIds: [this.classId],
      status: 'unread',
      vaultLink: '',
      url: '',
    });
    this.onAdd(resource);
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

// ─── Resource modals ──────────────────────────────────────────────────────────

class AddResourceModal extends Modal {
  constructor(app, plugin, semesterId, classes, onSave) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.classes = classes;
    this.onSave = onSave;
    this.formData = { title: '', author: '', type: '', classIds: [], status: 'unread', vaultLink: '', url: '' };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    this.modalEl.addClass('hc-resource-modal-frame');
    contentEl.addClass('hc-modal');
    contentEl.addClass('hc-resource-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Add resource' });

    new Setting(contentEl).setName('Title').addText(text => {
      text.setPlaceholder('The Jewish Study Bible').onChange(v => this.formData.title = v);
      text.inputEl.focus();
    });

    new Setting(contentEl).setName('Author').addText(text => {
      text.setPlaceholder('Author name').onChange(v => this.formData.author = v);
    });

    new Setting(contentEl).setName('Type').addDropdown(drop => {
      drop.addOption('', '— Select type —');
      drop.addOption('Book', 'Book');
      drop.addOption('PDF', 'PDF');
      drop.addOption('Handout', 'Handout');
      drop.addOption('Article', 'Article');
      drop.addOption('Online resource', 'Online resource');
      drop.addOption('Other', 'Other');
      drop.setValue(this.formData.type);
      drop.onChange(v => this.formData.type = v);
    });

    new Setting(contentEl).setName('Status').addDropdown(drop => {
      drop.addOption('unread', 'Unread');
      drop.addOption('in-progress', 'In Progress');
      drop.addOption('done', 'Done');
      drop.setValue(this.formData.status);
      drop.onChange(v => this.formData.status = v);
    });

    if (this.classes.length > 0) {
      const setting = new Setting(contentEl).setName('Classes');
      const picker = setting.controlEl.createDiv('hc-days-picker');
      for (const cls of this.classes) {
        const chip = picker.createEl('button', { cls: 'hc-day-toggle', text: cls.code, type: 'button' });
        chip.addEventListener('click', () => {
          const idx = this.formData.classIds.indexOf(cls.id);
          if (idx === -1) { this.formData.classIds.push(cls.id); chip.addClass('hc-day-toggle--active'); }
          else { this.formData.classIds.splice(idx, 1); chip.removeClass('hc-day-toggle--active'); }
        });
      }
    }

    const addVaultLinkSetting = new Setting(contentEl).setName('Vault link');
    const renderAddVaultLinkField = () => {
      addVaultLinkSetting.controlEl.empty();
      const path = this.formData.vaultLink || '';

      if (path) {
        // #8: read-only once set, matching the other vault-link fields
        // (Resource detail, Lecture Notes, Assignment Linked Note) —
        // typing over a filename-only display would silently save a
        // folder-less path. Browse/Remove are the only way to change it.
        // (LiveAQuietLife/Claude, 2026-08-30)
        addVaultLinkSetting.controlEl.createDiv({ cls: 'hc-assign-link-display', text: path.split('/').pop() });
      } else {
        const input = addVaultLinkSetting.controlEl.createEl('input', { type: 'text' });
        input.placeholder = 'path/to/file.md';
        input.value = path;
        input.addEventListener('input', () => { this.formData.vaultLink = input.value; });
      }

      const browseBtn = addVaultLinkSetting.controlEl.createEl('button', { text: 'Browse' });
      browseBtn.addEventListener('click', () => {
        new VaultLinkSuggestModal(this.app, (selectedPath) => {
          this.formData.vaultLink = selectedPath;
          renderAddVaultLinkField();
        }).open();
      });

      if (path) {
        const removeBtn = addVaultLinkSetting.controlEl.createEl('button', { text: 'Remove' });
        removeBtn.addEventListener('click', () => {
          this.formData.vaultLink = '';
          renderAddVaultLinkField();
        });
      }
    };
    renderAddVaultLinkField();

    new Setting(contentEl).setName('URL').addText(text => {
      text.setPlaceholder('https://…').onChange(v => this.formData.url = v);
      text.inputEl.type = 'url';
    });

    this._renderFooter(contentEl, 'Add resource', () => this._save());
  }

  _save() {
    if (!this.formData.title.trim()) { new Notice('Title is required.'); return; }
    this.plugin.addResource(this.semesterId, this.formData);
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

class EditResourceModal extends Modal {
  constructor(app, plugin, semesterId, classes, resource, onSave) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.classes = classes;
    this.resource = resource;
    this.onSave = onSave;
    this.formData = {
      title: resource.title || '',
      author: resource.author || '',
      type: resource.type || '',
      classIds: [...(resource.classIds || [])],
      status: resource.status || 'unread',
      vaultLink: resource.vaultLink || '',
      url: resource.url || '',
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    this.modalEl.addClass('hc-resource-modal-frame');
    contentEl.addClass('hc-modal');
    contentEl.addClass('hc-resource-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Edit resource' });

    new Setting(contentEl).setName('Title').addText(text => {
      text.setValue(this.formData.title).onChange(v => this.formData.title = v);
      text.inputEl.focus();
    });

    new Setting(contentEl).setName('Author').addText(text => {
      text.setValue(this.formData.author).onChange(v => this.formData.author = v);
    });

    new Setting(contentEl).setName('Type').addDropdown(drop => {
      drop.addOption('', '— Select type —');
      drop.addOption('Book', 'Book');
      drop.addOption('PDF', 'PDF');
      drop.addOption('Handout', 'Handout');
      drop.addOption('Article', 'Article');
      drop.addOption('Online resource', 'Online resource');
      drop.addOption('Other', 'Other');
      drop.setValue(this.formData.type);
      drop.onChange(v => this.formData.type = v);
    });

    new Setting(contentEl).setName('Status').addDropdown(drop => {
      drop.addOption('unread', 'Unread');
      drop.addOption('in-progress', 'In Progress');
      drop.addOption('done', 'Done');
      drop.setValue(this.formData.status);
      drop.onChange(v => this.formData.status = v);
    });

    if (this.classes.length > 0) {
      const setting = new Setting(contentEl).setName('Classes');
      const picker = setting.controlEl.createDiv('hc-days-picker');
      for (const cls of this.classes) {
        const chip = picker.createEl('button', { cls: 'hc-day-toggle', text: cls.code, type: 'button' });
        if (this.formData.classIds.includes(cls.id)) chip.addClass('hc-day-toggle--active');
        chip.addEventListener('click', () => {
          const idx = this.formData.classIds.indexOf(cls.id);
          if (idx === -1) { this.formData.classIds.push(cls.id); chip.addClass('hc-day-toggle--active'); }
          else { this.formData.classIds.splice(idx, 1); chip.removeClass('hc-day-toggle--active'); }
        });
      }
    }

    const editVaultLinkSetting = new Setting(contentEl).setName('Vault link');
    const renderEditVaultLinkField = () => {
      editVaultLinkSetting.controlEl.empty();
      const path = this.formData.vaultLink || '';

      if (path) {
        // #8: read-only once set, matching the other vault-link fields
        // (Resource detail, Lecture Notes, Assignment Linked Note) —
        // typing over a filename-only display would silently save a
        // folder-less path. Browse/Remove are the only way to change it.
        // (LiveAQuietLife/Claude, 2026-08-30)
        editVaultLinkSetting.controlEl.createDiv({ cls: 'hc-assign-link-display', text: path.split('/').pop() });
      } else {
        const input = editVaultLinkSetting.controlEl.createEl('input', { type: 'text' });
        input.placeholder = 'path/to/file.md';
        input.value = path;
        input.addEventListener('input', () => { this.formData.vaultLink = input.value; });
      }

      const browseBtn = editVaultLinkSetting.controlEl.createEl('button', { text: 'Browse' });
      browseBtn.addEventListener('click', () => {
        new VaultLinkSuggestModal(this.app, (selectedPath) => {
          this.formData.vaultLink = selectedPath;
          renderEditVaultLinkField();
        }).open();
      });

      if (path) {
        const removeBtn = editVaultLinkSetting.controlEl.createEl('button', { text: 'Remove' });
        removeBtn.addEventListener('click', () => {
          this.formData.vaultLink = '';
          renderEditVaultLinkField();
        });
      }
    };
    renderEditVaultLinkField();

    new Setting(contentEl).setName('URL').addText(text => {
      text.setValue(this.formData.url).setPlaceholder('https://…').onChange(v => this.formData.url = v);
      text.inputEl.type = 'url';
    });

    this._renderFooter(contentEl, 'Save changes', () => this._save());
  }

  _save() {
    if (!this.formData.title.trim()) { new Notice('Title is required.'); return; }
    this.plugin.updateResource(this.semesterId, this.resource.id, {
      title: this.formData.title.trim(),
      author: this.formData.author.trim(),
      type: this.formData.type.trim(),
      classIds: this.formData.classIds,
      status: this.formData.status,
      vaultLink: this.formData.vaultLink.trim(),
      url: this.formData.url.trim(),
    });
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

class DeleteResourceModal extends Modal {
  constructor(app, plugin, semesterId, resource, onDelete) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.resource = resource;
    this.onDelete = onDelete;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Delete resource' });
    contentEl.createEl('p', {
      cls: 'hc-modal-body',
      text: `Delete "${this.resource.title}"? This cannot be undone.`,
    });

    const footer = contentEl.createDiv('hc-modal-footer');
    const cancelBtn = footer.createEl('button', { cls: 'hc-btn', text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());
    const deleteBtn = footer.createEl('button', { cls: 'hc-btn hc-btn--danger', text: 'Delete resource' });
    deleteBtn.addEventListener('click', () => {
      this.plugin.deleteResource(this.semesterId, this.resource.id);
      this.onDelete();
      this.close();
    });
  }

  onClose() { this.contentEl.empty(); }
}

// ─── Today Sidebar View ───────────────────────────────────────────────────────

class HoldCourseTodayView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType()    { return TODAY_VIEW_TYPE; }
  getDisplayText() { return 'Hold Course — Today'; }
  getIcon()        { return 'calendar-clock'; }

  async onOpen()  {
    this.render();
    // Re-render when the date rolls over so Today/Tomorrow stay truthful overnight
    this.registerInterval(window.setInterval(() => {
      if (this._renderedISO && this._renderedISO !== getTodayISO()) this.render();
    }, 60 * 1000));
  }
  async onClose() { this.contentEl.empty(); }

  render() {
    this._renderedISO = getTodayISO();
    const { contentEl } = this;
    contentEl.empty();

    const root = contentEl.createDiv('hc-today-root');

    const sem = this.plugin.getCurrentSemester();
    if (!sem) {
      root.createDiv({ cls: 'hc-today-empty', text: 'No semester found.' });
      return;
    }

    const todayISO    = getTodayISO();
    const tomorrowISO = addDaysISO(todayISO, 1);

    this._renderSection(root, sem, todayISO, 'Today');
    this._renderSection(root, sem, tomorrowISO, 'Tomorrow');
  }

  // A lecture only carries a start time once a matching class meeting slot
  // has merged one onto it for today; everything else (assignments, exams,
  // untimed lectures) has no time-of-day concept.
  _itemStartTime(item) {
    if (item.kind === 'lecture' && item.meetingStartTime) return item.meetingStartTime;
    return null;
  }

  _renderSection(root, sem, dateISO, label) {
    const items = getItemsForDate(sem, dateISO, null);

    const section = root.createDiv('hc-today-section');
    section.createDiv({ cls: 'hc-today-section-label', text: label });

    if (items.length === 0) {
      section.createDiv({ cls: 'hc-today-empty-msg', text: `Nothing ${label === 'Today' ? 'today' : 'tomorrow'}.` });
      return;
    }

    const untimed = items.filter(i => !this._itemStartTime(i));
    const timed   = items
      .filter(i => this._itemStartTime(i))
      .sort((a, b) => this._itemStartTime(a).localeCompare(this._itemStartTime(b)));

    // Band labels only earn their place when there's an actual split to
    // announce — a single unadorned list otherwise, no header hanging over
    // a one-item section.
    const showBandLabels = untimed.length > 0 && timed.length > 0;

    if (showBandLabels) {
      section.createDiv({
        cls: 'hc-today-band-label',
        text: label === 'Today' ? 'Due today' : 'Due tomorrow',
      });
    }
    for (const item of untimed) this._renderTodayItem(section, item);
    for (const item of timed)   this._renderTodayItem(section, item);
  }

  _renderTodayItem(section, item) {
    const style   = getCalItemStyle(item);
    const isDone  = this._isItemDone(item);
    const row     = section.createDiv('hc-today-item');

    const pill = row.createDiv('hc-today-pill');
    if (isDone) {
      pill.style.background = 'var(--background-modifier-border)';
      pill.style.color      = 'var(--text-muted)';
    } else {
      pill.style.background = style.bg;
      pill.style.color      = style.color;
    }
    if (item.kind === 'lecture') pill.addClass('hc-today-pill--lecture');

    const titleEl = pill.createDiv({ cls: 'hc-today-item-title', text: item.title });
    if (isDone) titleEl.style.textDecoration = 'line-through';

    const meta = pill.createDiv({ cls: 'hc-today-item-meta' });
    let metaText;
    if (item.kind === 'lecture') {
      metaText = item.cls.code + ' · Lecture';
      if (item.meetingStartTime) metaText += ' · ' + formatTimeRange(item.meetingStartTime, item.meetingEndTime);
    } else if (item.kind === 'exam') {
      metaText = item.cls.code + ' · Exam';
    } else {
      metaText = item.cls.code + ' · ' + item.assignment.type;
    }
    meta.setText(metaText);

    row.addEventListener('click', () => this._navigateToItem(item));
  }

  _isItemDone(item) {
    if (item.kind === 'lecture')    return item.lec.status === 'done';
    if (item.kind === 'assignment') return item.assignment.status === 'done';
    if (item.kind === 'exam')       return item.exam.status === 'done';
    return false;
  }

  async _navigateToItem(item) {
    const { workspace } = this.app;

    // Ensure main HC tab is open
    let mainLeaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!mainLeaf) {
      mainLeaf = workspace.getLeaf('tab');
      await mainLeaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(mainLeaf);

    // Navigate to the item
    const view = mainLeaf.view;
    if (!(view instanceof HoldCourseView)) return;

    if (item.kind === 'lecture')    view.navigate('lecture',    item.cls.id, item.lec.id);
    if (item.kind === 'assignment') view.navigate('assignment', item.cls.id, item.lectureId, item.assignment.id);
    if (item.kind === 'exam')       view.navigate('exam',       item.cls.id, null, null, item.exam.id);
  }
}

// ─── Shared modal behaviours — attach after all class definitions ─────────────

const DRAGGABLE_MODALS = [
  AddSemesterModal, EditSemesterModal, AddClassModal, EditClassModal,
  AddLectureModal, EditLectureModal, BulkAddLecturesModal,
  AddAssignmentModal, BulkAddAssignmentsModal, EditAssignmentModal, MoveAssignmentModal,
  AddExamModal, EditExamModal,
  QuickAddResourceModal, AddResourceModal, EditResourceModal,
];
for (const Cls of DRAGGABLE_MODALS) {
  Cls.prototype._makeDraggable = _makeDraggable;
}

AddSemesterModal.prototype._renderFooter    = _renderFooter;
EditSemesterModal.prototype._renderFooter   = _renderFooter;
AddClassModal.prototype._renderFooter       = _renderFooter;
EditClassModal.prototype._renderFooter      = _renderFooter;
AddLectureModal.prototype._renderFooter     = _renderFooter;
EditLectureModal.prototype._renderFooter    = _renderFooter;
AddAssignmentModal.prototype._renderFooter  = _renderFooter;
EditAssignmentModal.prototype._renderFooter = _renderFooter;
MoveAssignmentModal.prototype._renderFooter = _renderFooter;
AddExamModal.prototype._renderFooter        = _renderFooter;
EditExamModal.prototype._renderFooter       = _renderFooter;
AddResourceModal.prototype._renderFooter    = _renderFooter;
EditResourceModal.prototype._renderFooter   = _renderFooter;

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = HoldCoursePlugin;

/* nosourcemap */