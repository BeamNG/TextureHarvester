
import { reactive } from "vue";
import { TX } from "../tx.js";

const SHOW_AFTER = 200;

const state = reactive({
  active: false,
  visible: false,
  title: "",
  detail: "",
  value: null,
  startedAt: 0,
});

let depth = 0;

const breathe = () => new Promise(resolve => setTimeout(resolve, 0));

let showTimer = null;

function reset() {
  clearTimeout(showTimer);
  showTimer = null;
  state.active = false;
  state.visible = false;
  state.title = "";
  state.detail = "";
  state.value = null;
  state.startedAt = 0;
}

async function report(value, detail) {
  if (value != null && Number.isFinite(value)) {
    state.value = Math.max(0, Math.min(1, value));
  }
  if (detail != null) state.detail = String(detail);
  await breathe();
}

async function run(title, worker) {
  const outermost = depth === 0;
  depth++;
  if (outermost) {
    state.active = true;
    state.visible = false;
    state.startedAt = Date.now();
    state.value = null;
    state.detail = "";
    clearTimeout(showTimer);
    showTimer = setTimeout(() => { state.visible = true; }, SHOW_AFTER);
  }
  const previousTitle = state.title;
  if (title) state.title = String(title);

  await breathe();

  try {
    return await worker(report);
  } finally {
    depth = Math.max(0, depth - 1);
    if (depth === 0) reset();
    else state.title = previousTitle;
  }
}

async function each(items, label, work) {
  const list = [...items];
  for (let i = 0; i < list.length; i++) {
    await report(i / list.length, label(list[i], i, list.length));
    await work(list[i], i);
  }
  await report(1, "");
  return list.length;
}

TX.progress = { SHOW_AFTER, state, run, report, each, breathe };

