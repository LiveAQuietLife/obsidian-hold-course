/* --- Hold Course --- v0.3.0 */ 
'use strict';

const {
  Plugin,
  ItemView,
  Modal,
  Setting,
  Notice,
  Menu,
  setIcon,
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
    this.currentTab = 'Lectures';
    // Track open dropdown cleanup
    this._semDropEl = null;
    this._semCloseHandler = null;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Hold Course'; }
  getIcon() { return 'graduation-cap'; }

  async onOpen() { this.render(); }
  async onClose() { this._closeSemDrop(); }

  navigate(screen, classId = null, lectureId = null, assignmentId = null, examId = null) {
    // Reset tab when moving to a different class
    if (screen === 'class' && classId !== this.currentClassId) {
      this.currentTab = 'Lectures';
    }
    this.screen = screen;
    this.currentClassId = classId;
    this.currentLectureId = lectureId;
    this.currentAssignmentId = assignmentId;
    this.currentExamId = examId;
    this.render();
  }

  navigateTab(tab) {
    this.currentTab = tab;
    this.render();
  }

  refresh() { this.render(); }

  render() {
    this._closeSemDrop();

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
      case 'assignments':  this._renderAssignmentsStub(content); break;
      case 'calendar':     this._renderCalendarStub(content); break;
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
      const totalAssigns = getAllAssignments(sem).filter(a => a.status !== 'done').length;
      if (totalAssigns > 0) parts.push(`${totalAssigns} pending`);
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
    const weekEnd = getWeekEndISO();

    const todayLectures = [];
    for (const cls of sem.classes) {
      for (const lec of (cls.lectures || [])) {
        if (lec.date === today) todayLectures.push({ cls, lec });
      }
    }

    const dueThisWeek = getAllAssignments(sem)
      .filter(a => a.status !== 'done' && a.dueDate && a.dueDate <= weekEnd)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    if (!todayLectures.length && !dueThisWeek.length) return;

    const strip = content.createDiv('hc-today-strip');

    // Today's lectures column
    const todayDate = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    if (todayLectures.length) {
      const col = strip.createDiv('hc-today-col');
      col.createDiv({ cls: 'hc-today-label', text: `Today — ${todayDate}` });
      for (const { cls, lec } of todayLectures) {
        const color = getColor(cls.colorIndex);
        const row = col.createDiv('hc-today-row');
        const dot = row.createDiv('hc-today-dot');
        dot.style.background = color.accent;
        row.createSpan({ text: `${cls.code} · ${lec.title}` });
      }
    }

    // Due this week column
    if (dueThisWeek.length) {
      const col = strip.createDiv('hc-today-col');
      col.createDiv({ cls: 'hc-today-label', text: 'Due this week' });
      for (const a of dueThisWeek.slice(0, 5)) {
        const info = getDueInfo(a.dueDate);
        const row = col.createDiv('hc-today-row');
        const dot = row.createDiv('hc-today-dot');
        dot.style.background = info ? info.color : getColor(a.colorIndex).accent;
        const span = row.createSpan({ text: `${a.title} · ${formatDate(a.dueDate)}` });
        if (info?.urgency === 'overdue' || info?.urgency === 'today') {
          span.style.color = '#A32D2D';
        }
      }
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
    } else {
      const placeholder = content.createDiv('hc-placeholder');
      const icon = placeholder.createDiv({ cls: 'hc-placeholder-icon' });
      setIcon(icon, 'construction');
      placeholder.createDiv({ cls: 'hc-placeholder-text', text: `${this.currentTab} coming in a future build.` });
    }
  }

  _renderLectureList(content, sem, cls, color) {
    // Sort toggle row
    const sortDesc = cls.lectureSort === 'desc';
    const sorted = getLecturesSorted(cls);
    const displayed = sortDesc ? [...sorted].reverse() : sorted;

    const controlRow = content.createDiv('hc-lecture-controls');

    const sortBtn = controlRow.createEl('button', { cls: 'hc-btn hc-btn--sm' });
    const sortIcon = sortBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(sortIcon, sortDesc ? 'arrow-down-narrow-wide' : 'arrow-up-narrow-wide');
    sortBtn.createSpan({ text: sortDesc ? 'Newest first' : 'Oldest first' });
    sortBtn.addEventListener('click', () => {
      cls.lectureSort = sortDesc ? 'asc' : 'desc';
      this.plugin.save();
      this.render();
    });

    // Lecture list
    const list = content.createDiv('hc-lecture-list');

    if (sorted.length === 0) {
      const empty = list.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'No lectures yet. Add your first one below.' });
    } else {
      for (const lec of displayed) {
        const chronNum = sorted.indexOf(lec) + 1;
        this._renderLectureRow(list, lec, chronNum, color, sem, cls);
      }
    }

    // Add lecture button
    const addBtn = content.createEl('button', { cls: 'hc-btn hc-lecture-add-btn' });
    const addIcon = addBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(addIcon, 'plus');
    addBtn.createSpan({ text: 'Add lecture' });
    addBtn.addEventListener('click', () => {
      new AddLectureModal(this.app, this.plugin, sem.id, cls.id, () => {
        this.plugin.save();
        this.render();
      }).open();
    });
  }

  _renderLectureRow(list, lec, num, color, sem, cls) {
    const row = list.createDiv('hc-lecture-row');

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

    // Back button
    const backBtn = content.createEl('button', { cls: 'hc-btn hc-lecture-back-btn' });
    const backIcon = backBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(backIcon, 'arrow-left');
    backBtn.createSpan({ text: cls.code });
    backBtn.addEventListener('click', () => this.navigate('class', cls.id));

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

    // Assignments section
    content.createDiv({ cls: 'hc-lecture-section-label', text: 'Assignments' });
    const assignList = content.createDiv('hc-lecture-assign-list');

    if (!lec.assignments || lec.assignments.length === 0) {
      assignList.createDiv({ cls: 'hc-empty-text hc-lecture-assign-empty', text: 'No assignments for this lecture.' });
    } else {
      for (const a of lec.assignments) {
        const aRow = assignList.createDiv('hc-lecture-assign-row');
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
    // Collect all assignments with lecture context
    const items = [];
    for (const a of (cls.assignments || [])) {
      items.push({ assignment: a, lectureTitle: null });
    }
    const sorted = getLecturesSorted(cls);
    for (const lec of sorted) {
      for (const a of (lec.assignments || [])) {
        items.push({ assignment: a, lectureTitle: lec.title });
      }
    }

    const controlRow = content.createDiv('hc-assign-controls');
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
    } else {
      // Sort by due date
      items.sort((a, b) => {
        if (!a.assignment.dueDate && !b.assignment.dueDate) return 0;
        if (!a.assignment.dueDate) return 1;
        if (!b.assignment.dueDate) return -1;
        return a.assignment.dueDate.localeCompare(b.assignment.dueDate);
      });
      for (const { assignment, lectureTitle } of items) {
        this._renderAssignmentRow(list, assignment, lectureTitle, sem, cls);
      }
    }
  }

  _renderAssignmentRow(container, assignment, lectureTitle, sem, cls) {
    const typeStyle = ASSIGNMENT_TYPE_STYLE[assignment.type] || ASSIGNMENT_TYPE_STYLE['Other'];
    const info = assignment.dueDate ? getDueInfo(assignment.dueDate) : null;

    const row = container.createDiv('hc-assign-row');
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
      text: lectureTitle ? lectureTitle : 'Class-level',
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

    // Back button
    const backBtn = content.createEl('button', { cls: 'hc-btn hc-lecture-back-btn' });
    const backIcon = backBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(backIcon, 'arrow-left');
    backBtn.createSpan({ text: cls.code });
    backBtn.addEventListener('click', () => {
      this.currentTab = 'Assignments';
      this.navigate('class', cls.id);
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
      const bookInput = content.createEl('input', { cls: 'hc-assign-link-input', type: 'text' });
      bookInput.placeholder = 'Book title (Library link coming later)';
      bookInput.value = assignment.linkedBook || '';
      bookInput.addEventListener('blur', () => {
        assignment.linkedBook = bookInput.value;
        this.plugin.save();
      });
    }

    // Linked note (Writing only)
    if (assignment.type === 'Writing') {
      content.createDiv({ cls: 'hc-lecture-section-label', text: 'Linked Note' });
      const noteInput = content.createEl('input', { cls: 'hc-assign-link-input', type: 'text' });
      noteInput.placeholder = 'Note name (file picker coming later)';
      noteInput.value = assignment.linkedNote || '';
      noteInput.addEventListener('blur', () => {
        assignment.linkedNote = noteInput.value;
        this.plugin.save();
      });
    }
  }

  // ─── Exam list ────────────────────────────────────────────────────────────

  _renderExamList(content, sem, cls, color) {
    const exams = [...(cls.exams || [])].sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

    const list = content.createDiv('hc-exam-list');

    if (exams.length === 0) {
      const empty = list.createDiv('hc-empty');
      empty.createDiv({ cls: 'hc-empty-text', text: 'No exams yet. Add your first one below.' });
    } else {
      for (const exam of exams) {
        this._renderExamRow(list, exam, sem, cls);
      }
    }

    const addBtn = content.createEl('button', { cls: 'hc-btn hc-lecture-add-btn' });
    const addIcon = addBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(addIcon, 'plus');
    addBtn.createSpan({ text: 'Add exam' });
    addBtn.addEventListener('click', () => {
      new AddExamModal(this.app, this.plugin, sem.id, cls, () => {
        this.plugin.save();
        this.render();
      }).open();
    });
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

    // Back button
    const backBtn = content.createEl('button', { cls: 'hc-btn hc-lecture-back-btn' });
    const backIcon = backBtn.createSpan({ cls: 'hc-btn-icon' });
    setIcon(backIcon, 'arrow-left');
    backBtn.createSpan({ text: cls.code });
    backBtn.addEventListener('click', () => {
      this.currentTab = 'Exams';
      this.navigate('class', cls.id);
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

  // ─── Stub screens ─────────────────────────────────────────────────────────

  _renderAssignmentsStub(content) {
    const placeholder = content.createDiv('hc-placeholder');
    const icon = placeholder.createDiv({ cls: 'hc-placeholder-icon' });
    setIcon(icon, 'construction');
    placeholder.createDiv({ cls: 'hc-placeholder-text', text: 'Global assignments view coming in the next build.' });
  }

  _renderCalendarStub(content) {
    const placeholder = content.createDiv('hc-placeholder');
    const icon = placeholder.createDiv({ cls: 'hc-placeholder-icon' });
    setIcon(icon, 'construction');
    placeholder.createDiv({ cls: 'hc-placeholder-text', text: 'Calendar view coming in a future build.' });
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
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Add lecture' });

    new Setting(contentEl).setName('Title').addText(text => {
      text.setPlaceholder('Introduction & Canon Formation').onChange(v => this.formData.title = v);
      text.inputEl.focus();
      text.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') this._save(); });
    });

    new Setting(contentEl).setName('Date').addText(text => {
      text.inputEl.type = 'date';
      text.onChange(v => this.formData.date = v);
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
    contentEl.addClass('hc-modal');
    contentEl.createEl('h2', { cls: 'hc-modal-title', text: 'Edit lecture' });

    new Setting(contentEl).setName('Title').addText(text => {
      text.setValue(this.formData.title).onChange(v => this.formData.title = v);
      text.inputEl.focus();
      text.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') this._save(); });
    });

    new Setting(contentEl).setName('Date').addText(text => {
      text.inputEl.type = 'date';
      text.inputEl.value = this.formData.date;
      text.onChange(v => this.formData.date = v);
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
      new Setting(container).setName('Linked book').addText(text => {
        text.setPlaceholder('Book title (Library link coming later)');
        text.onChange(v => this.formData.linkedBook = v);
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
      new Setting(container).setName('Linked book').addText(text => {
        text.setValue(this.formData.linkedBook).setPlaceholder('Book title');
        text.onChange(v => this.formData.linkedBook = v);
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

// ─── Shared footer — attach after all class definitions ───────────────────────

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

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = HoldCoursePlugin;
