/* --- Hold Course --- v0.4.14 */ 
'use strict';

const {
  Plugin,
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

const COLOR_PALETTE = [
  { name: 'amber',  accent: '#BA7517', light: '#FAC775', bg: '#FAEEDA', text: '#633806' },
  { name: 'teal',   accent: '#0F6E56', light: '#9FE1CB', bg: '#E1F5EE', text: '#04342C' },
  { name: 'coral',  accent: '#993C1D', light: '#F5C4B3', bg: '#FAECE7', text: '#4A1B0C' },
  { name: 'purple', accent: '#534AB7', light: '#CECBF6', bg: '#EEEDFE', text: '#26215C' },
  { name: 'pink',   accent: '#993556', light: '#F4C0D1', bg: '#FBEAF0', text: '#4B1528' },
  { name: 'green',  accent: '#3B6D11', light: '#C0DD97', bg: '#EAF3DE', text: '#173404' },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const ASSIGNMENT_TYPES = ['Reading', 'Writing', 'Project', 'Discussion', 'Other'];

const ASSIGNMENT_TYPE_STYLE = {
  'Reading':    { color: '#1B6FCC', bg: '#E8F1FC' },
  'Writing':    { color: '#BA7517', bg: '#FAEEDA' },
  'Quiz':       { color: '#0F6E56', bg: '#E1F5EE' },
  'Exam':       { color: '#993C1D', bg: '#FAECE7' },
  'Project':    { color: '#534AB7', bg: '#EEEDFE' },
  'Discussion': { color: '#3B6D11', bg: '#EAF3DE' },
  'Other':      { color: '#666', bg: '#F0F0F0' },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function getColor(index) {
  return COLOR_PALETTE[index % COLOR_PALETTE.length];
}

function getTodayISO() {
  return new Date().toISOString().split('T')[0];
}

function getWeekEndISO() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().split('T')[0];
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
  if (diff < 0)  return { label: `${dateStr} · overdue`, color: '#E24B4A', note: 'Overdue', noteColor: '#A32D2D', urgency: 'overdue' };
  if (diff === 0) return { label: `${dateStr} · today`,   color: '#E24B4A', note: 'Today',   noteColor: '#A32D2D', urgency: 'today' };
  if (diff === 1) return { label: `${dateStr} · tomorrow`,color: '#BA7517', note: 'Tomorrow',noteColor: '#854F0B', urgency: 'soon' };
  if (diff <= 7)  return { label: `${dateStr} · ${diff} days`, color: '#BA7517', note: `${diff} days`, noteColor: '#854F0B', urgency: 'soon' };
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

function getItemsForDate(sem, dateISO, filterClassId) {
  const items = [];
  for (const cls of (sem.classes || [])) {
    if (filterClassId && cls.id !== filterClassId) continue;
    for (const lec of (cls.lectures || [])) {
      if (lec.date === dateISO) {
        items.push({ kind: 'lecture', title: lec.title, cls, lec });
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
  }
  return items;
}

function getCalItemStyle(item) {
  if (item.kind === 'lecture') {
    const c = getColor(item.cls.colorIndex);
    return { color: c.accent, bg: c.bg };
  }
  if (item.kind === 'exam')       return ASSIGNMENT_TYPE_STYLE['Exam'] || { color: '#666', bg: '#F0F0F0' };
  if (item.kind === 'assignment') return ASSIGNMENT_TYPE_STYLE[item.assignment.type] || ASSIGNMENT_TYPE_STYLE['Other'];
  return { color: '#666', bg: '#F0F0F0' };
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

class HoldCoursePlugin extends Plugin {
  async onload() {
    this.data = await this.loadData() || { currentSemesterId: null, semesters: [] };

    this.registerView(VIEW_TYPE, (leaf) => new HoldCourseView(leaf, this));

    this.addRibbonIcon('graduation-cap', 'Hold Course', () => this.activateView());

    this.addCommand({
      id: 'open-hold-course',
      name: 'Open Hold Course',
      callback: () => this.activateView(),
    });
  }

  onunload() {}

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async save() {
    await this.saveData(this.data);
  }

  // ─── Semester helpers ──────────────────────────────────────────────────────

  getCurrentSemester() {
    const sems = this.data.semesters || [];
    return sems.find(s => s.id === this.data.currentSemesterId) || sems[0] || null;
  }

  setCurrentSemester(id) {
    this.data.currentSemesterId = id;
  }

  addSemester(name) {
    const sem = { id: generateId(), name: name.trim(), classes: [] };
    if (!this.data.semesters) this.data.semesters = [];
    this.data.semesters.push(sem);
    if (!this.data.currentSemesterId) this.data.currentSemesterId = sem.id;
    return sem;
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
      professorName: classData.professorName.trim(),
      professorEmail: classData.professorEmail.trim(),
      meetingDays: classData.meetingDays || [],
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
    this.currentTab = 'Lectures';
    this.previousScreen = null;
    this.globalAssignFilterClassId = null;
    this.globalAssignFilterType = null;
    this.libraryFilterClassId = null;
    // Calendar session state
    this.calView = 'month';
    this.calYear = null;
    this.calMonth = null;
    this.calWeekStart = null;
    this.calFilterClassId = null;
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

  navigate(screen, classId = null, lectureId = null, assignmentId = null, examId = null, resourceId = null) {
    // Reset tab and library filter when moving to a different class
    if (screen === 'class' && classId !== this.currentClassId) {
      this.currentTab = 'Lectures';
      this.libraryFilterClassId = null;
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
      case 'assignments':  this._renderAssignmentsStub(content); break;
      case 'calendar':     this._renderCalendarView(content); break;
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
    const sem = this.plugin.getCurrentSemester();
    if (!sem || ['dashboard', 'assignments', 'calendar'].includes(this.screen)) return;

    const ovBtn = bc.createEl('button', { cls: 'hc-bc-link', text: 'Overview' });
    ovBtn.addEventListener('click', () => this.navigate('dashboard'));

    if (this.screen === 'class' && this.currentClassId) {
      const cls = sem.classes.find(c => c.id === this.currentClassId);
      if (cls) {
        bc.createSpan({ cls: 'hc-bc-sep', text: '›' });
        const span = bc.createSpan({ text: cls.code });
        span.style.color = getColor(cls.colorIndex).accent;
        span.style.fontWeight = '500';
        span.style.fontSize = '12px';
      }
    }

    if (this.screen === 'lecture' && this.currentClassId && this.currentLectureId) {
      const cls = sem.classes.find(c => c.id === this.currentClassId);
      if (cls) {
        bc.createSpan({ cls: 'hc-bc-sep', text: '›' });
        const clsBtn = bc.createEl('button', { cls: 'hc-bc-link', text: cls.code });
        clsBtn.style.color = getColor(cls.colorIndex).accent;
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
        bc.createSpan({ cls: 'hc-bc-sep', text: '›' });
        const clsBtn = bc.createEl('button', { cls: 'hc-bc-link', text: cls.code });
        clsBtn.style.color = getColor(cls.colorIndex).accent;
        clsBtn.style.fontWeight = '500';
        clsBtn.addEventListener('click', () => {
          this.currentTab = 'Assignments';
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
        clsBtn.style.color = getColor(cls.colorIndex).accent;
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
        clsBtn.style.color = getColor(cls.colorIndex).accent;
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
    const sems = this.plugin.data.semesters || [];

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

      for (const s of sems) {
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

    const strip = content.createDiv('hc-today-strip');

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
    codeEl.style.color = color.accent;

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
    body.createDiv({ cls: 'hc-class-name', text: cls.name });

    // Professor
    if (cls.professorName) {
      const prof = body.createDiv('hc-class-prof');
      const icon = prof.createSpan({ cls: 'hc-inline-icon' });
      setIcon(icon, 'user');
      prof.createSpan({ text: cls.professorName });
    }

    // Meeting days
    if (cls.meetingDays?.length) {
      const daysRow = body.createDiv('hc-class-days');
      for (const day of cls.meetingDays) {
        daysRow.createSpan({ cls: 'hc-day-chip', text: day });
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

    card.addEventListener('click', () => this.navigate('class', cls.id));
  }

  // ─── Class view ───────────────────────────────────────────────────────────

  _renderClassView(content) {
    const sem = this.plugin.getCurrentSemester();
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
    codeEl.style.color = color.accent;

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

    header.createDiv({ cls: 'hc-class-header-name', text: cls.name });

    const meta = header.createDiv('hc-class-header-meta');

    if (cls.professorName) {
      const item = meta.createDiv('hc-class-meta-item');
      const icon = item.createSpan({ cls: 'hc-inline-icon' });
      setIcon(icon, 'user');
      icon.style.color = color.accent;
      item.createSpan({ text: cls.professorName });
    }

    if (cls.professorEmail) {
      const item = meta.createDiv('hc-class-meta-item');
      const icon = item.createSpan({ cls: 'hc-inline-icon' });
      setIcon(icon, 'mail');
      icon.style.color = color.accent;
      const link = item.createEl('a', { text: cls.professorEmail, href: `mailto:${cls.professorEmail}` });
      link.style.color = color.accent;
    }

    if (cls.meetingDays?.length) {
      const item = meta.createDiv('hc-class-meta-item');
      const icon = item.createSpan({ cls: 'hc-inline-icon' });
      setIcon(icon, 'clock');
      icon.style.color = color.accent;
      item.createSpan({ text: cls.meetingDays.join(' · ') });
    }

    // Tab row — functional
    const tabRow = content.createDiv('hc-tab-row');
    const tabs = ['Lectures', 'Assignments', 'Exams', 'Library'];
    for (const tab of tabs) {
      const btn = tabRow.createEl('button', { cls: 'hc-tab', text: tab });
      if (tab === this.currentTab) {
        btn.addClass('hc-tab--active');
        btn.style.color = color.accent;
        btn.style.borderBottomColor = color.accent;
      }
      btn.addEventListener('click', () => this.navigateTab(tab));
    }

    if (this.currentTab === 'Lectures') {
      this._renderLectureList(content, sem, cls, color);
    } else if (this.currentTab === 'Assignments') {
      this._renderAssignmentList(content, sem, cls, color);
    } else if (this.currentTab === 'Exams') {
      this._renderExamList(content, sem, cls, color);
    } else if (this.currentTab === 'Library') {
      this._renderLibraryList(content, sem, cls, color);
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

    const addBtn = controlRow.createEl('button', { cls: 'hc-btn' });
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

    const assignCount = (lec.assignments || []).length;
    if (assignCount > 0) {
      right.createDiv({
        cls: 'hc-lecture-assign-count',
        text: `${assignCount} ${assignCount === 1 ? 'assignment' : 'assignments'}`,
      });
    }

    const statusEl = right.createDiv({ cls: `hc-lecture-status hc-lecture-status--${lec.status}` });
    statusEl.setText(statusLabel(lec.status));

    const chev = right.createDiv('hc-lecture-chevron');
    setIcon(chev, 'chevron-right');

    row.addEventListener('click', () => this.navigate('lecture', cls.id, lec.id));
  }

  // ─── Lecture detail ───────────────────────────────────────────────────────

  _renderLectureDetail(content) {
    const sem = this.plugin.getCurrentSemester();
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
    labelEl.style.color = color.accent;

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
      const linkInput = textWrap.createEl('input', { cls: 'hc-assign-link-input', type: 'text' });
      linkInput.placeholder = 'path/to/notes.md';
      linkInput.value = path;
      linkInput.addEventListener('blur', () => {
        lec.vaultLink = linkInput.value.trim();
        this.plugin.save();
      });

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

    // Assignments section
    content.createDiv({ cls: 'hc-lecture-section-label', text: 'Assignments' });
    const assignList = content.createDiv('hc-lecture-assign-list');

    if (!lec.assignments || lec.assignments.length === 0) {
      assignList.createDiv({ cls: 'hc-empty-text hc-lecture-assign-empty', text: 'No assignments for this lecture.' });
    } else {
      for (const a of lec.assignments) {
        const aRow = assignList.createDiv('hc-lecture-assign-row hc-lecture-assign-row--clickable');
        aRow.addEventListener('click', () => this.navigate('assignment', cls.id, lec.id, a.id));
        if (a.type) {
          const pill = aRow.createSpan({ cls: 'hc-assign-type-pill', text: a.type });
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

    const addAssignBtn = content.createEl('button', { cls: 'hc-btn hc-lecture-add-btn' });
    const addAssignIcon = addAssignBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(addAssignIcon, 'plus');
    addAssignBtn.createSpan({ text: 'Add assignment' });
    addAssignBtn.addEventListener('click', () => {
      new AddAssignmentModal(this.app, this.plugin, sem.id, cls, () => {
        this.plugin.save();
        this.render();
      }, lec.id).open();
    });
  }

  // ─── Assignment list ──────────────────────────────────────────────────────

  _renderAssignmentList(content, sem, cls, color) {
    if (cls.assignShowDone === undefined) cls.assignShowDone = true;
    const showDone = cls.assignShowDone;

    // Collect all assignments with lecture context
    const items = [];
    for (const a of (cls.assignments || [])) {
      items.push({ assignment: a, lectureLabel: null });
    }
    const sorted = getLecturesSorted(cls);
    sorted.forEach((lec, i) => {
      for (const a of (lec.assignments || [])) {
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

    const displayed = showDone ? items : items.filter(i => i.assignment.status !== 'done');

    const controlRow = content.createDiv('hc-assign-controls');

    const doneToggle = controlRow.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const doneIcon = doneToggle.createSpan({ cls: 'hc-btn-icon' });
    setIcon(doneIcon, showDone ? 'eye-off' : 'eye');
    doneToggle.createSpan({ text: showDone ? 'Hide done' : 'Show done' });
    doneToggle.addEventListener('click', () => {
      cls.assignShowDone = !cls.assignShowDone;
      this.plugin.save();
      this.render();
    });

    const addBtn = controlRow.createEl('button', { cls: 'hc-btn' });
    const addIcon = addBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(addIcon, 'plus');
    addBtn.createSpan({ text: 'Add assignment' });
    addBtn.addEventListener('click', () => {
      new AddAssignmentModal(this.app, this.plugin, sem.id, cls, () => {
        this.plugin.save();
        this.render();
      }).open();
    });

    const list = content.createDiv('hc-assign-list');

    if (items.length === 0) {
      const empty = list.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'No assignments yet.' });
    } else if (displayed.length === 0) {
      const empty = list.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'All assignments done.' });
    } else {
      for (const { assignment, lectureLabel } of displayed) {
        this._renderAssignmentRow(list, assignment, lectureLabel, sem, cls);
      }
    }
  }

  _renderAssignmentRow(container, assignment, lectureLabel, sem, cls) {
    const typeStyle = ASSIGNMENT_TYPE_STYLE[assignment.type] || ASSIGNMENT_TYPE_STYLE['Other'];
    const info = assignment.dueDate ? getDueInfo(assignment.dueDate) : null;

    const row = container.createDiv('hc-assign-row');
    if (assignment.status === 'done') row.addClass('hc-assign-row--done');
    if (assignment.type === 'Writing') row.addClass('hc-assign-row--writing');

    // Left: type pill
    const pill = row.createSpan({ cls: 'hc-assign-pill', text: assignment.type || 'Other' });
    pill.style.color = typeStyle.color;
    pill.style.background = typeStyle.bg;

    // Middle: title, lecture, status
    const mid = row.createDiv('hc-assign-mid');
    mid.createDiv({ cls: 'hc-assign-title', text: assignment.title });
    mid.createDiv({
      cls: 'hc-assign-lecture',
      text: lectureLabel ? lectureLabel : 'Class-level',
    });
    const statusEl = mid.createDiv({ cls: `hc-assign-status hc-assign-status--${assignment.status}` });
    statusEl.setText(statusLabel(assignment.status));

    // Right: due date
    const right = row.createDiv('hc-assign-due');
    const isDone = assignment.status === 'done';
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
    const sem = this.plugin.getCurrentSemester();
    if (!sem) { this.navigate('dashboard'); return; }
    const cls = sem.classes.find(c => c.id === this.currentClassId);
    if (!cls) { this.navigate('dashboard'); return; }
    const result = this.plugin.findAssignment(sem.id, cls.id, this.currentAssignmentId);
    if (!result) { this.currentTab = 'Assignments'; this.navigate('class', cls.id); return; }

    const { assignment, lectureId } = result;
    const color = getColor(cls.colorIndex);
    const typeStyle = ASSIGNMENT_TYPE_STYLE[assignment.type] || ASSIGNMENT_TYPE_STYLE['Other'];

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
        this.currentTab = 'Assignments';
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
        this.currentTab = 'Assignments';
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
        this.currentTab = 'Assignments';
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

    // Linked note (Writing only)
    if (assignment.type === 'Writing') {
      content.createDiv({ cls: 'hc-lecture-section-label', text: 'Linked Note' });
      const noteSection = content.createDiv('hc-assign-note-section');

      const renderNoteSection = () => {
        noteSection.empty();
        const path = assignment.linkedNote || '';

        const noteRow = noteSection.createDiv('hc-assign-note-row');
        const textWrap = noteRow.createDiv('hc-assign-note-input-wrap');
        const noteInput = textWrap.createEl('input', { cls: 'hc-assign-link-input', type: 'text' });
        noteInput.placeholder = 'path/to/note.md';
        noteInput.value = path;
        noteInput.addEventListener('blur', () => {
          assignment.linkedNote = noteInput.value.trim();
          this.plugin.save();
        });

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
      info.createSpan({ cls: 'hc-exam-done-badge', text: 'Done' });
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

    row.addEventListener('click', () => this.navigate('exam', cls.id, null, null, exam.id));
  }

  // ─── Exam detail ──────────────────────────────────────────────────────────

  _renderExamDetail(content) {
    const sem = this.plugin.getCurrentSemester();
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
        lbl.style.color = getColor(c.colorIndex).accent;
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
          chip.style.color = getColor(c.colorIndex).accent;
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
    const sem = this.plugin.getCurrentSemester();
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
          chip.style.color = getColor(c.colorIndex).accent;
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
        vaultInfo.createDiv({ cls: 'hc-resource-source-path', text: resource.vaultLink });
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
        chip.style.color = getColor(refCls.colorIndex).accent;
        chip.style.background = getColor(refCls.colorIndex).bg;

        const refInfo = refRow.createDiv('hc-resource-ref-info');
        refInfo.createDiv({ cls: 'hc-resource-ref-title', text: assignment.title });
        refInfo.createDiv({ cls: 'hc-resource-ref-lecture', text: lectureLabel });

        const chevron = refRow.createSpan({ cls: 'hc-resource-ref-chevron' });
        setIcon(chevron, 'chevron-right');

        refRow.addEventListener('click', () => this.navigate('assignment', refCls.id, null, assignment.id));
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

  // ─── Stub screens ─────────────────────────────────────────────────────────

  _renderAssignmentsStub(content) {
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
        label.style.color = getColor(cls.colorIndex).accent;
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
        const typeStyle = ASSIGNMENT_TYPE_STYLE[type] || ASSIGNMENT_TYPE_STYLE['Other'];
        const item = typeDropEl.createDiv('hc-sem-drop-item');
        if (type === this.globalAssignFilterType) item.addClass('hc-sem-drop-item--active');
        const icon = item.createSpan({ cls: 'hc-sem-drop-icon' });
        if (type === this.globalAssignFilterType) setIcon(icon, 'check');
        const lbl = item.createSpan({ text: type });
        lbl.style.color = typeStyle.color;
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

      const typeStyle = ASSIGNMENT_TYPE_STYLE[a.type] || ASSIGNMENT_TYPE_STYLE['Other'];
      const info      = a.dueDate ? getDueInfo(a.dueDate) : null;
      const color     = getColor(cls.colorIndex);

      const row = list.createDiv('hc-assign-row');
      if (a.status === 'done') row.addClass('hc-assign-row--done');

      // Type pill
      const pill = row.createSpan({ cls: 'hc-assign-pill', text: a.type || 'Other' });
      pill.style.color = typeStyle.color;
      pill.style.background = typeStyle.bg;

      // Middle: title, class chip + lecture context, status
      const mid = row.createDiv('hc-assign-mid');
      mid.createDiv({ cls: 'hc-assign-title', text: a.title });

      const contextRow = mid.createDiv('hc-assign-context-row');
      const classChip  = contextRow.createSpan({ cls: 'hc-assign-class-chip', text: cls.code });
      classChip.style.color = color.accent;

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

      const statusEl = mid.createDiv({ cls: `hc-assign-status hc-assign-status--${a.status}` });
      statusEl.setText(statusLabel(a.status));

      // Right: due date
      const right = row.createDiv('hc-assign-due');
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
      const style = ASSIGNMENT_TYPE_STYLE[type];
      if (!style) continue;
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
      const items   = getItemsForDate(sem, dateISO, this.calFilterClassId);

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
        const pill = cell.createDiv('hc-cal-pill');
        pill.style.background = style.bg;
        pill.style.color = overdue ? '#E24B4A' : style.color;
        pill.setText(item.title);
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
      const items   = getItemsForDate(sem, dateISO, this.calFilterClassId);

      const cell = grid.createDiv('hc-cal-week-cell');
      if (isToday) cell.addClass('hc-cal-week-cell--today');
      if (items.length > 0) {
        cell.addClass('hc-cal-week-cell--has-items');
        cell.addEventListener('click', () => this._showCalPopover(items, cell, dateISO));
      }

      for (const item of items) {
        const style = getCalItemStyle(item);
        const overdue = this._isCalItemOverdue(item);
        const pill = cell.createDiv('hc-cal-week-pill');
        pill.style.background = style.bg;
        pill.style.color = overdue ? '#E24B4A' : style.color;
        pill.setText(item.title);
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
        lbl.style.color = getColor(cls.colorIndex).accent;
        item.addEventListener('click', () => { this.calFilterClassId = cls.id; closeDrop(); this.render(); });
      }

      setTimeout(() => document.addEventListener('click', () => closeDrop(), { once: true }), 0);
    });
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
        : item.kind === 'exam'       ? 'Exam'
        : (item.assignment.type || 'Assignment');
      info.createSpan({ cls: 'hc-cal-popover-kind',  text: kindText });
      info.createDiv({  cls: 'hc-cal-popover-title', text: item.title });

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
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'New semester' });

    new Setting(contentEl)
      .setName('Semester name')
      .setDesc('e.g. Fall 2025, Spring 2026')
      .addText(text => {
        text.setPlaceholder('Fall 2025').onChange(v => this.name = v);
        text.inputEl.focus();
        text.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') this._save(); });
      });

    this._renderFooter(contentEl, 'Create semester', () => this._save());
  }

  _save() {
    if (!this.name.trim()) { new Notice('Semester name is required.'); return; }
    this.plugin.addSemester(this.name);
    this.onSave();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}

class AddClassModal extends Modal {
  constructor(app, plugin, semesterId, onSave) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.onSave = onSave;
    this.formData = { name: '', code: '', professorName: '', professorEmail: '', meetingDays: [] };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Add class' });

    new Setting(contentEl).setName('Class name').addText(text => {
      text.setPlaceholder('Introduction to the Old Testament').onChange(v => this.formData.name = v);
      text.inputEl.focus();
    });

    new Setting(contentEl).setName('Class code').addText(text => {
      text.setPlaceholder('RLST 145').onChange(v => this.formData.code = v);
    });

    new Setting(contentEl).setName('Professor name').addText(text => {
      text.setPlaceholder('Dr. Sarah Cohen').onChange(v => this.formData.professorName = v);
    });

    new Setting(contentEl).setName('Professor email').addText(text => {
      text.setPlaceholder('cohen@university.edu').onChange(v => this.formData.professorEmail = v);
      text.inputEl.type = 'email';
    });

    this._renderDaysPicker(contentEl);
    this._renderFooter(contentEl, 'Add class', () => this._save());
  }

  _renderDaysPicker(contentEl) {
    const setting = new Setting(contentEl).setName('Meeting days');
    const picker = setting.controlEl.createDiv('hc-days-picker');
    for (const day of DAYS) {
      const chip = picker.createEl('button', { cls: 'hc-day-toggle', text: day, type: 'button' });
      chip.addEventListener('click', () => {
        const idx = this.formData.meetingDays.indexOf(day);
        if (idx === -1) { this.formData.meetingDays.push(day); chip.addClass('hc-day-toggle--active'); }
        else { this.formData.meetingDays.splice(idx, 1); chip.removeClass('hc-day-toggle--active'); }
      });
    }
  }

  _save() {
    if (!this.formData.name.trim()) { new Notice('Class name is required.'); return; }
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
    this.formData = {
      name: cls.name || '',
      code: cls.code || '',
      professorName: cls.professorName || '',
      professorEmail: cls.professorEmail || '',
      meetingDays: [...(cls.meetingDays || [])],
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Edit class' });

    new Setting(contentEl).setName('Class name').addText(text => {
      text.setValue(this.formData.name).onChange(v => this.formData.name = v);
      text.inputEl.focus();
    });

    new Setting(contentEl).setName('Class code').addText(text => {
      text.setValue(this.formData.code).onChange(v => this.formData.code = v);
    });

    new Setting(contentEl).setName('Professor name').addText(text => {
      text.setValue(this.formData.professorName).onChange(v => this.formData.professorName = v);
    });

    new Setting(contentEl).setName('Professor email').addText(text => {
      text.setValue(this.formData.professorEmail).onChange(v => this.formData.professorEmail = v);
      text.inputEl.type = 'email';
    });

    this._renderDaysPicker(contentEl);
    this._renderFooter(contentEl, 'Save changes', () => this._save());
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
    this.plugin.updateClass(this.semesterId, this.cls.id, {
      name: this.formData.name.trim(),
      code: this.formData.code.trim(),
      professorName: this.formData.professorName.trim(),
      professorEmail: this.formData.professorEmail.trim(),
      meetingDays: this.formData.meetingDays,
    });
    this.onSave();
    this.close();
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

class AddAssignmentModal extends Modal {
  constructor(app, plugin, semesterId, cls, onSave, defaultLectureId = null) {
    super(app);
    this.plugin = plugin;
    this.semesterId = semesterId;
    this.cls = cls;
    this.onSave = onSave;
    this.formData = { title: '', type: 'Reading', dueDate: '', lectureId: defaultLectureId || null };
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
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Add assignment' });

    new Setting(contentEl).setName('Title').addText(text => {
      text.setPlaceholder('Introduction to the OT, Ch. 1-3').onChange(v => this.formData.title = v);
      text.inputEl.focus();
    });

    new Setting(contentEl).setName('Type').addDropdown(drop => {
      for (const t of ASSIGNMENT_TYPES) drop.addOption(t, t);
      drop.setValue(this.formData.type);
      drop.onChange(v => { this.formData.type = v; this._updateConditional(contentEl); });
    });

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

    this._renderFooter(contentEl, 'Add assignment', () => this._save());
  }

  _updateConditional(contentEl) {
    const container = contentEl.querySelector('.hc-assign-conditional');
    if (!container) return;
    container.empty();
    if (this.formData.type === 'Reading') {
      const sem = this.plugin.data.semesters.find(s => s.id === this.semesterId);
      const classResources = sem ? (sem.resources || []).filter(r => (r.classIds || []).includes(this.cls.id)) : [];

      const setting = new Setting(container).setName('Linked book');
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

    } else if (this.formData.type === 'Writing') {
      new Setting(container).setName('Linked note').addText(text => {
        text.setPlaceholder('Note name (file picker coming later)');
        text.onChange(v => this.formData.linkedNote = v);
      });
    }
  }

  _save() {
    if (!this.formData.title.trim()) { new Notice('Assignment title is required.'); return; }
    const assign = this.plugin.addAssignment(this.semesterId, this.cls.id, this.formData.lectureId, this.formData);
    if (assign && this.formData.linkedBook) assign.linkedBook = this.formData.linkedBook;
    if (assign && this.formData.linkedNote) assign.linkedNote = this.formData.linkedNote;
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

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    this._makeDraggable(this);
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Edit assignment' });

    new Setting(contentEl).setName('Title').addText(text => {
      text.setValue(this.formData.title).onChange(v => this.formData.title = v);
      text.inputEl.focus();
    });

    new Setting(contentEl).setName('Type').addDropdown(drop => {
      for (const t of ASSIGNMENT_TYPES) drop.addOption(t, t);
      drop.setValue(this.formData.type);
      drop.onChange(v => { this.formData.type = v; this._updateConditional(contentEl); });
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

    } else if (this.formData.type === 'Writing') {
      new Setting(container).setName('Linked note').addText(text => {
        text.setValue(this.formData.linkedNote).setPlaceholder('Note name');
        text.onChange(v => this.formData.linkedNote = v);
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
      linkedNote: this.formData.type === 'Writing' ? this.formData.linkedNote : '',
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
    contentEl.addClass('hc-modal');
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

    let vaultLinkEl = null;
    new Setting(contentEl).setName('Vault link').addText(text => {
      text.setPlaceholder('path/to/file.md').onChange(v => this.formData.vaultLink = v);
      vaultLinkEl = text.inputEl;
    }).addButton(btn => {
      btn.setButtonText('Browse').onClick(() => {
        new VaultLinkSuggestModal(this.app, (path) => {
          this.formData.vaultLink = path;
          if (vaultLinkEl) vaultLinkEl.value = path;
        }).open();
      });
    });

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
    contentEl.addClass('hc-modal');
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

    let vaultLinkEl = null;
    new Setting(contentEl).setName('Vault link').addText(text => {
      text.setValue(this.formData.vaultLink).setPlaceholder('path/to/file.md').onChange(v => this.formData.vaultLink = v);
      vaultLinkEl = text.inputEl;
    }).addButton(btn => {
      btn.setButtonText('Browse').onClick(() => {
        new VaultLinkSuggestModal(this.app, (path) => {
          this.formData.vaultLink = path;
          if (vaultLinkEl) vaultLinkEl.value = path;
        }).open();
      });
    });

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

// ─── Shared modal behaviours — attach after all class definitions ─────────────

const DRAGGABLE_MODALS = [
  AddSemesterModal, AddClassModal, EditClassModal,
  AddLectureModal, EditLectureModal,
  AddAssignmentModal, EditAssignmentModal, MoveAssignmentModal,
  AddExamModal, EditExamModal,
  QuickAddResourceModal, AddResourceModal, EditResourceModal,
];
for (const Cls of DRAGGABLE_MODALS) {
  Cls.prototype._makeDraggable = _makeDraggable;
}

AddSemesterModal.prototype._renderFooter    = _renderFooter;
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
