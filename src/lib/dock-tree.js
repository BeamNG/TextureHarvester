
import { TX } from "../tx.js";

let counter = 0;
const nodeId = () => `n${++counter}`;

const tabs = (panels, active) => ({
  id: nodeId(),
  type: "tabs",
  panels: panels.slice(),
  active: active || panels[0] || null,
});

const split = (dir, children, sizes) => ({
  id: nodeId(),
  type: "split",
  dir,
  children,
  sizes: sizes || children.map(() => 1 / children.length),
});

const clone = node => (node.type === "tabs"
  ? { id: node.id, type: "tabs", panels: node.panels.slice(), active: node.active }
  : { id: node.id, type: "split", dir: node.dir, sizes: node.sizes.slice(), children: node.children.map(clone) });

function walk(node, visit, parent) {
  if (!node) return;
  visit(node, parent);
  if (node.type === "split") for (const child of node.children) walk(child, visit, node);
}

function findNode(root, id) {
  let found = null;
  walk(root, node => { if (node.id === id) found = node; });
  return found;
}

function findParent(root, id) {
  let found = null;
  walk(root, (node, parent) => { if (node.id === id) found = parent; });
  return found;
}

function findPanel(root, panelId) {
  let found = null;
  walk(root, node => {
    if (node.type === "tabs" && node.panels.includes(panelId)) found = node;
  });
  return found;
}

function collectPanels(root) {
  const out = [];
  walk(root, node => {
    if (node.type === "tabs") out.push(...node.panels);
  });
  return out;
}

function normalizeSizes(node) {
  const total = node.sizes.reduce((a, b) => a + b, 0);
  node.sizes = total > 0
    ? node.sizes.map(s => s / total)
    : node.children.map(() => 1 / node.children.length);
}

function prune(node) {
  if (!node) return null;
  if (node.type === "tabs") return node.panels.length ? node : null;

  const children = node.children.map(prune);
  const kept = [];
  const sizes = [];
  children.forEach((child, i) => {
    if (!child) return;
    kept.push(child);
    sizes.push(node.sizes[i] == null ? 1 / children.length : node.sizes[i]);
  });

  if (!kept.length) return null;
  if (kept.length === 1) return kept[0];

  const flatChildren = [];
  const flatSizes = [];
  kept.forEach((child, i) => {
    if (child.type === "split" && child.dir === node.dir) {
      child.children.forEach((grand, gi) => {
        flatChildren.push(grand);
        flatSizes.push(sizes[i] * child.sizes[gi]);
      });
    } else {
      flatChildren.push(child);
      flatSizes.push(sizes[i]);
    }
  });

  node.children = flatChildren;
  node.sizes = flatSizes;
  normalizeSizes(node);
  return node;
}

function removePanel(root, panelId) {
  const next = clone(root);
  walk(next, node => {
    if (node.type !== "tabs") return;
    const index = node.panels.indexOf(panelId);
    if (index === -1) return;
    node.panels.splice(index, 1);
    if (node.active === panelId) {
      node.active = node.panels[Math.min(index, node.panels.length - 1)] || null;
    }
  });
  return prune(next);
}

const DIR_FOR_ZONE = { left: "row", right: "row", top: "col", bottom: "col" };
const BEFORE_ZONE = { left: true, top: true, right: false, bottom: false };

function insertPanel(root, panelId, targetId, zone) {
  if (!root) return tabs([panelId]);

  const next = clone(root);
  const target = findNode(next, targetId) || next;

  if (zone === "center" && target.type === "tabs") {
    if (!target.panels.includes(panelId)) target.panels.push(panelId);
    target.active = panelId;
    return prune(next);
  }

  const dir = DIR_FOR_ZONE[zone] || "row";
  const before = !!BEFORE_ZONE[zone];
  const leaf = tabs([panelId]);
  const parent = findParent(next, target.id);

  if (parent && parent.type === "split" && parent.dir === dir) {
    const index = parent.children.indexOf(target);
    const share = parent.sizes[index];
    const at = before ? index : index + 1;
    parent.children.splice(at, 0, leaf);
    parent.sizes.splice(index, 1, share / 2, share / 2);
    normalizeSizes(parent);
    return prune(next);
  }

  const replacement = split(dir, before ? [leaf, target] : [target, leaf], [0.5, 0.5]);

  if (target === next) return prune(replacement);

  const index = parent.children.indexOf(target);
  parent.children[index] = replacement;
  return prune(next);
}

function insertAtRootEdge(root, panelId, edge) {
  if (!root) return tabs([panelId]);
  const dir = DIR_FOR_ZONE[edge] || "row";
  const before = !!BEFORE_ZONE[edge];
  const leaf = tabs([panelId]);
  const next = clone(root);

  if (next.type === "split" && next.dir === dir) {
    if (before) {
      next.children.unshift(leaf);
      next.sizes.unshift(0.25);
    } else {
      next.children.push(leaf);
      next.sizes.push(0.25);
    }
    normalizeSizes(next);
    return prune(next);
  }

  return prune(split(dir, before ? [leaf, next] : [next, leaf], before ? [0.25, 0.75] : [0.75, 0.25]));
}

function movePanel(root, panelId, targetId, zone) {
  const without = removePanel(root, panelId);
  if (!without) return tabs([panelId]);
  const target = findNode(without, targetId);
  if (!target) {
    const fallback = findPanel(without, collectPanels(without)[0]);
    return insertPanel(without, panelId, fallback ? fallback.id : without.id, zone === "center" ? "center" : zone);
  }
  return insertPanel(without, panelId, targetId, zone);
}

function setActive(root, panelId) {
  const next = clone(root);
  const holder = findPanel(next, panelId);
  if (holder) holder.active = panelId;
  return next;
}

function setSizes(root, nodeId_, sizes) {
  const next = clone(root);
  const node = findNode(next, nodeId_);
  if (node && node.type === "split") {
    node.sizes = sizes.slice();
    normalizeSizes(node);
  }
  return next;
}

function reorderTab(root, panelId, targetIndex) {
  const next = clone(root);
  const holder = findPanel(next, panelId);
  if (!holder) return next;
  const from = holder.panels.indexOf(panelId);
  holder.panels.splice(from, 1);
  holder.panels.splice(Math.max(0, Math.min(holder.panels.length, targetIndex)), 0, panelId);
  return next;
}

function reid(root) {
  const next = clone(root);
  walk(next, node => { node.id = nodeId(); });
  return next;
}

function reconcile(root, knownPanels) {
  const known = new Set(knownPanels);
  if (!root) return null;
  let next = clone(root);
  for (const panelId of collectPanels(next)) {
    if (!known.has(panelId)) next = removePanel(next, panelId) || tabs([]);
  }
  return next && collectPanels(next).length ? next : null;
}

function zoneAt(rect, point) {
  const fx = (point.x - rect.left) / rect.width;
  const fy = (point.y - rect.top) / rect.height;

  if (fx > 0.3 && fx < 0.7 && fy > 0.3 && fy < 0.7) return { zone: "center", rect };

  const nearest = [
    { zone: "left", d: fx },
    { zone: "right", d: 1 - fx },
    { zone: "top", d: fy },
    { zone: "bottom", d: 1 - fy },
  ].sort((a, b) => a.d - b.d)[0].zone;

  const half = { ...rect };
  if (nearest === "left") half.width = rect.width / 2;
  if (nearest === "right") { half.left = rect.left + rect.width / 2; half.width = rect.width / 2; }
  if (nearest === "top") half.height = rect.height / 2;
  if (nearest === "bottom") { half.top = rect.top + rect.height / 2; half.height = rect.height / 2; }
  return { zone: nearest, rect: half };
}

const isValid = node => {
  if (!node || typeof node !== "object") return false;
  if (node.type === "tabs") return Array.isArray(node.panels);
  if (node.type === "split") {
    return Array.isArray(node.children) && node.children.length > 0
      && Array.isArray(node.sizes) && node.sizes.length === node.children.length
      && node.children.every(isValid);
  }
  return false;
};

TX.dockTree = {
  tabs,
  split,
  clone,
  walk,
  findNode,
  findParent,
  findPanel,
  collectPanels,
  removePanel,
  insertPanel,
  insertAtRootEdge,
  movePanel,
  setActive,
  setSizes,
  reorderTab,
  reid,
  reconcile,
  prune,
  zoneAt,
  isValid,
};

