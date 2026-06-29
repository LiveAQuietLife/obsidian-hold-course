# Hold Course

Always know where you are.

---

Hold Course is an academic tracker for Obsidian. Add your semesters and classes, log your lectures, and track your assignments and exams — all in one place, all in your vault. No syncing, no accounts. Just your courses, clearly laid out.

> **Note:** Hold Course is designed for desktop use. Mobile is not supported.

---

## Table of Contents

- [What It Is](#what-it-is)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [Semesters](#semesters)
- [Classes](#classes)
- [Lectures](#lectures)
- [Assignments](#assignments)
- [Exams](#exams)
- [Library](#library)
- [Calendar View](#calendar-view)
- [Assignments View](#assignments-view)
- [HC Today Sidebar](#hc-today-sidebar)
- [Command Palette Shortcuts](#command-palette-shortcuts)
- [Linked Notes](#linked-notes)
- [Data Storage](#data-storage)

---

## What It Is

Hold Course grew out of a simple frustration: syllabi don't fit cleanly into task lists. I'm self-taught, working through courses and curricula on my own schedule, and what started as a manageable system of lists eventually became its own job — tracking lectures, chasing readings, and trying to remember what connected to what. Hold Course is what I personally needed: an academic tracker that lives inside my vault, where my notes and resources are a click away instead of scattered somewhere else entirely.

Hold Course is built around a simple premise: you should always know exactly where you are in a course — which lectures you've attended, which assignments are coming, and what needs your attention today. It tells you where things stand. The rest is up to you.

Classes are organized into **semesters**. Each class holds its own **lectures**, **assignments**, **exams**, and a **library** of resources referenced across your coursework. You advance items through their status as you go, and optionally link anything to notes in your vault. The plugin tracks the rest.

---

## Installation

Search for **Hold Course** in Obsidian's community plugin browser (*Settings > Community plugins > Browse*), install, and enable it. The plugin adds a **Hold Course** icon to your left ribbon.

---

## Getting Started

Click the Hold Course ribbon icon to open the plugin. It opens as a full-width tab.

On first launch you'll see the **Overview** — an empty workspace. Here's the typical setup flow for a new semester:

1. **Create a semester** using the semester dropdown at the top of the Overview.
2. **Add your classes** to the semester — one for each course you're taking.
3. **Open a class** and start adding lectures. You can add all your lectures up front and fill in assignments later, or build them out together as you work through the syllabus — whichever fits how you read a course schedule.
4. **Add exams** on the Exams tab for any high-stakes dates you need to track separately.
5. **Add resources** to the Library as you encounter them, or quick-add them from within a lecture or assignment and fill in the details later.

From there, it's a matter of advancing item statuses as the semester moves. So turn this:

<img src="screenshots/overview-blank.jpg" width="700" alt="Overview on Startup">

into this:

<img src="screenshots/overview-sidebar.jpg" width="700" alt="Overview with sidebar">

---

## Semesters

The semester dropdown at the top of the Overview lets you switch between semesters or create a new one. Only one semester is active at a time, but your data from previous semesters stays in place.

**Creating a semester:** Open the dropdown and click **+ New Semester**.

**Switching semesters:** Select any semester from the dropdown.

---

## Classes

Inside a semester, each class appears as a card on the Overview showing the class name, course code, and instructor.

**Adding a class:** Click **+ Add Class** and fill in the details — name, course code, instructor, and professor email if you have it.

**Opening a class:** Click the class card. Each class has four tabs: **Lectures**, **Assignments**, **Exams**, and **Library**.

**Editing or deleting a class:** Open the class and use the Edit or Delete buttons in the detail screen.

**Lecture progress:** Once you've marked at least one lecture done, the class card shows a progress fraction — lectures completed out of total logged.

**Professor email:** If an email address is saved to the class, it appears as a clickable link that opens your operating system's default mail client.

> **Note:** The professor email link requires a default mail client configured on your system (such as Mail on macOS or Outlook on Windows). If no default mail client is set, the link may not open.

**Course page URL:** If a URL is saved to the class, it appears as a quiet external-link icon next to the class name on the dashboard card, and as a "Course page" link in the class header. Useful for linking to a course portal, Coursera page, or syllabus hosted online.

---

## Lectures

Inside a class, the **Lectures** tab lists all logged lectures in order.

**Adding a lecture:** Click **+ Add Lecture** and fill in the title and date.

**Status:** Each lecture has a status pill that cycles through **Not Started / In Progress / Done**. Click the pill to advance it. Done lectures appear with muted styling — present in the record, but visually stepped back so your attention goes to what's ahead. Completed lectures can be hidden completely by using the **Show done/Hide done** toggle.

**Sort order:** Use the sort toggle to switch between oldest-first and newest-first.

**Lecture detail:** Click a lecture to open its detail screen, where you can edit fields, link the lecture to a note in your vault, or quick-add a resource to the Library.


<img src="screenshots/class-detail.jpg" width="700" alt="Class">

---

## Assignments

Inside a class, the **Assignments** tab lists all logged assignments.

**Adding an assignment:** Click **+ Add Assignment** and fill in the title, due date, type, and any other details.

**Assignment types:** Each assignment has a type — Reading, Writing, Project, Discussion, or Other — color-coded throughout the plugin so you can scan quickly.

**Grade:** Assignments have an optional grade field. Fill it in after graded work is returned.

**Filtering:** Use the **All types** dropdown to show only one kind of assignment. The **Show done/Hide Done** toggle works alongside the filter — they stack.

**Status:** Each assignment has a status pill that cycles through **Not Started/In Progress/Done**. Click the pill to advance it. Done assignments appear with muted styling across all views. Completed assignments can be hidden completely by using the **Show done/Hide done** toggle. 

**Assignment detail:** Click an assignment to open its detail screen, where you can edit all fields, link the assignment to a note in your vault, or quick-add a resource to the Library.

<img src="screenshots/assignments.jpg" width="700" alt="Assignments">

---

## Exams

Inside a class, the **Exams** tab lists scheduled exams with their dates and a live countdown to each one.

**Adding an exam:** Click **+ Add Exam** and fill in the name and date.

**Countdowns:** Each exam shows how many days away it is, updated automatically.

**Status:** Click an exam to open its detail screen, where you can mark it done. Done exams can be hidden using the **Show done/Hide done** toggle on the Exams tab.

Exams appear on the Calendar in their own color, distinct from lectures and assignments.

<img src="screenshots/exams.jpg" width="700" alt="Exams">
---

## Library

The **Library** tab collects every resource associated with a class — books, articles, reference works — into a single list. Resources accumulate here as you add them, and each one tracks which lectures and assignments reference it.

**Adding a resource:** Click **+ Add Resource** to add a resource directly to the Library. Resource types include Book, PDF, Handout, Article, Online resource, and Other.

**Filter by class:** The Library has an *All classes* filter, so you can view resources from a single class or across all your classes at once.

**Status:** Each resource has a status pill — **Unread**, **In Progress**, or **Done** — that you can advance as you read.

**Linked Book:** Reading assignments can be linked directly to a resource in the Library. For all other assignment types, a Linked Note field is available instead. Both are set from the assignment's detail screen.

**Resource detail:** Click any resource to see everything associated with it: the classes it belongs to, its type, and every lecture and assignment that references it — each one clickable through to the item itself.

<img src="screenshots/library.jpg" width="700" alt="Library">

<img src="screenshots/book-detail.jpg" width="700" alt="Book Detail">

---

## Calendar View

The **Calendar** shows all your lectures, assignments, and exams across all classes in one view.

**Week and month modes:** Switch between views using the toggle in the upper left.

**Legend:** The top of the calendar shows a color key — lectures listed by class, assignments listed by type (Reading, Writing, Discussion, Project, Exam, Other). Exams from the Exams tab appear in their own color.

**Class filter:** Use the **All classes** dropdown at the bottom to narrow the calendar to a single class.

**Day detail:** Click any day to open a popover listing every item scheduled for that date, each labeled with its type and class. Click any item in the popover to view its full detail screen.

Done items appear with strikethrough and muted styling in both the calendar and the day detail popover.

<img src="screenshots/calendar-week.jpg" width="700" alt="Weekly View Calendar">

<img src="screenshots/calendar-month.jpg" width="700" alt="Monthly View Calendar">

---

## Assignments View

The **Assignments** button in the toolbar opens a cross-class view of every assignment in the current semester — all classes combined in one list.

**Filtering:** Use the class filter to narrow to a single class, and the type filter to show only one assignment type. Both filters stack.

**Sorting:** Cycle through three sort modes — by due date, by class, or by status. Hold Course will remember your last choice. 

**Show done:** Use the **Show done** toggle to include completed assignments in the list.

Click any assignment to open its detail screen.

---

## HC Today Sidebar

Hold Course adds an **HC Today** panel to Obsidian's right sidebar. It shows everything due or happening today and tomorrow — lectures, assignments, and exams, all classes combined.

Each item shows its title and a subtitle line with the class name and item type. Lectures are color-coded by class; assignments are color-coded by type — the same system used throughout the plugin. Items you've marked done appear with strikethrough and muted gray styling so finished work recedes and what's still ahead stays visible.

**Opening:** The sidebar opens automatically when the plugin loads. Use the command palette to reopen the sidebar if necessary. 

**Navigating:** Click any item to open the main Hold Course tab and navigate directly to that item's detail screen.

**Auto-refresh:** The sidebar updates automatically whenever you make a change in Hold Course. You don't need to refresh it manually.

---

## Command Palette Shortcuts

Hold Course registers several commands in Obsidian's command palette (Ctrl/Cmd+P) for quick access without opening the plugin first:

- Open Hold Course — opens the main tab
- Open Hold Course — Today — opens the Today sidebar
- Add a class — opens the Add Class dialog for the active semester
- Open calendar — opens the main tab and navigates directly to Calendar view
- Show global assignments — opens the main tab and navigates to the Assignments view
- Add a library resource — opens the Add Resource dialog for the active semester
- Add a lecture — opens the Add Lecture dialog for the current class (requires an open class screen)
- Add an assignment — opens the Add Assignment dialog for the current class (requires an open class screen)

All commands are hotkey-bindable via Settings > Hotkeys.

---

## Linked Notes

Any lecture, assignment, or exam can be linked to an existing note in your vault. Set the link from the item's detail screen. Linked notes open directly from the detail screen.

---

## Data Storage

All plugin data is stored in `data.json` inside the Hold Course plugin folder. This file is created automatically on first use and holds all your semesters, classes, lectures, assignments, exams, and library resources. Back it up along with your vault.

---

*Hold Course is a community plugin for Obsidian. Feedback and bug reports are welcome via the GitHub repository. Screenshots were captured on vault using the Soft Paper theme by Nick Milo, https://linkingyourthinking.com*
