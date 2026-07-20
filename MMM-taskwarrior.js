/* global Module, moment */

/* MagicMirror²
 * Module: MMM-taskwarrior
 *
 * Displays a list of Taskwarrior tasks synced from a TaskChampion sync server.
 * Accepts regular Taskwarrior filters and optional sync overrides; all task
 * fetching happens in node_helper.js via the `task` CLI.
 */
Module.register("MMM-taskwarrior", {
	defaults: {
		// Taskwarrior filter — string ("status:pending +work") or array.
		filter: "status:pending",

		// Optional sync overrides. When omitted, the host's existing ~/.taskrc
		// (or `taskrc` below) is used as-is.
		serverUrl: "",
		serverPort: null,
		clientId: "", // TaskChampion client_id (the "key")
		encryptionSecret: "", // the "secret"

		updateInterval: 10, // minutes between refreshes
		autoSync: true, // run `task sync` before each export

		taskCommand: "task", // path/name of the Taskwarrior binary
		taskrc: null, // override TASKRC (path)
		taskData: null, // override TASKDATA (path)
		commandTimeout: 15000, // ms per `task` invocation

		// Display
		fields: ["description", "project", "due", "tags"],
		groupByProject: true,
		sortBy: "urgency", // "urgency" | "due" | "description"
		maximumEntries: 10,
		showHeader: true,
		title: "Tasks",
		showCount: true,
		highlightOverdue: true,
		dueSoonDays: 3,
		dateFormat: "relative", // "relative" or a moment format string
		fadeSpeed: 2000
	},

	getStyles() {
		return ["MMM-taskwarrior.css", "font-awesome.css"];
	},

	getScripts() {
		return []; // MagicMirror provides `moment` globally.
	},

	getHeader() {
		if (!this.config.showHeader) return null;
		let header = this.data.header || this.config.title;
		if (this.config.showCount && this.loaded && !this.error) {
			header += ` (${this.tasks.length})`;
		}
		return header;
	},

	start() {
		this.tasks = [];
		this.loaded = false;
		this.error = null;
		this.sendSocketNotification("START", {
			identifier: this.identifier,
			config: this.config
		});
	},

	socketNotificationReceived(notification, payload) {
		if (!payload || payload.identifier !== this.identifier) return;

		if (notification === "TASKS") {
			this.error = null;
			this.tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
			this.loaded = true;
			this.updateDom(this.config.fadeSpeed);
		} else if (notification === "TASK_ERROR") {
			this.error = payload.error;
			this.loaded = true;
			this.updateDom(this.config.fadeSpeed);
		}
	},

	// --- rendering ----------------------------------------------------------

	getDom() {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-taskwarrior";

		if (!this.loaded) {
			wrapper.innerHTML = this.translate ? this.translate("LOADING") : "Loading …";
			wrapper.classList.add("dimmed", "light", "small");
			return wrapper;
		}
		if (this.error) {
			wrapper.innerHTML = this.error;
			wrapper.classList.add("dimmed", "light", "small");
			return wrapper;
		}

		const tasks = this.sortTasks(this.tasks).slice(0, this.config.maximumEntries);
		if (tasks.length === 0) {
			wrapper.innerHTML = "No tasks";
			wrapper.classList.add("dimmed", "light", "small");
			return wrapper;
		}

		const table = document.createElement("table");
		table.className = "small";

		if (this.config.groupByProject) {
			const groups = this.groupByProject(tasks);
			for (const [project, groupTasks] of groups) {
				const headerRow = document.createElement("tr");
				const headerCell = document.createElement("td");
				headerCell.colSpan = 2;
				headerCell.className = "project-header dimmed";
				headerCell.textContent = project;
				headerRow.appendChild(headerCell);
				table.appendChild(headerRow);
				for (const task of groupTasks) table.appendChild(this.renderRow(task, true));
			}
		} else {
			for (const task of tasks) table.appendChild(this.renderRow(task, false));
		}

		wrapper.appendChild(table);
		return wrapper;
	},

	renderRow(task, grouped) {
		const row = document.createElement("tr");
		row.className = "task-row";

		const main = document.createElement("td");
		main.className = "task-main";
		if (grouped) main.classList.add("indented");

		const desc = document.createElement("span");
		desc.className = "task-description bright";
		desc.textContent = task.description || "(no description)";
		main.appendChild(desc);

		// Project (only shown inline when not already grouped under it).
		if (this.showField("project") && !grouped && task.project) {
			const proj = document.createElement("span");
			proj.className = "task-project dimmed";
			proj.textContent = task.project;
			main.appendChild(proj);
		}

		if (this.showField("tags") && Array.isArray(task.tags) && task.tags.length) {
			const tagWrap = document.createElement("span");
			tagWrap.className = "task-tags";
			for (const tag of task.tags) {
				const chip = document.createElement("span");
				chip.className = "task-tag";
				chip.textContent = tag;
				tagWrap.appendChild(chip);
			}
			main.appendChild(tagWrap);
		}

		row.appendChild(main);

		// Due date cell.
		const dueCell = document.createElement("td");
		dueCell.className = "task-due dimmed";
		if (this.showField("due") && task.due) {
			const due = moment(task.due, "YYYYMMDDTHHmmssZ");
			dueCell.textContent =
				this.config.dateFormat === "relative"
					? due.fromNow()
					: due.format(this.config.dateFormat);
			if (this.config.highlightOverdue) {
				if (due.isBefore(moment())) {
					dueCell.classList.remove("dimmed");
					dueCell.classList.add("overdue");
				} else if (due.isBefore(moment().add(this.config.dueSoonDays, "days"))) {
					dueCell.classList.remove("dimmed");
					dueCell.classList.add("due-soon");
				}
			}
		}
		row.appendChild(dueCell);

		return row;
	},

	// --- helpers ------------------------------------------------------------

	showField(name) {
		return this.config.fields.includes(name);
	},

	sortTasks(tasks) {
		const sorted = [...tasks];
		const by = this.config.sortBy;
		if (by === "due") {
			sorted.sort((a, b) => this.dueValue(a) - this.dueValue(b));
		} else if (by === "description") {
			sorted.sort((a, b) => (a.description || "").localeCompare(b.description || ""));
		} else {
			// urgency (default): highest first.
			sorted.sort((a, b) => (b.urgency || 0) - (a.urgency || 0));
		}
		return sorted;
	},

	dueValue(task) {
		if (!task.due) return Number.POSITIVE_INFINITY; // undated tasks last
		return moment(task.due, "YYYYMMDDTHHmmssZ").valueOf();
	},

	// Returns an ordered Map of project -> tasks, preserving the incoming
	// (already-sorted) task order within each group.
	groupByProject(tasks) {
		const groups = new Map();
		for (const task of tasks) {
			const project = task.project || "No project";
			if (!groups.has(project)) groups.set(project, []);
			groups.get(project).push(task);
		}
		return groups;
	}
});
