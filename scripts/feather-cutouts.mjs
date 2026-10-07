/**
 * 抠图边缘羽化：把 PNG 的 **alpha 通道**做高斯模糊，做出真正贴合的渐入边。
 *
 * 为什么必须在素材侧做，而不是 CSS：
 * 抠图的硬边是沿着**不规则轮廓**走的。CSS 的 `mask-image` 只能用线性/径向
 * 渐变，它羽化的是**视口边缘**，跟轮廓毫无关系；`filter: blur()` 则会把
 * 人物本身一起糊掉。唯一能沿着真实轮廓羽化的做法，就是让 PNG 自己的
 * alpha 在轮廓处渐变。
 *
 * 用法：
 *   node scripts/feather-cutouts.mjs [半径] [目录]
 *   node scripts/feather-cutouts.mjs 26                 # 默认半径 26px（源尺寸）
 *   node scripts/feather-cutouts.mjs 26 assets
 *
 * 半径按**源图**像素计。抠图是 5465px 宽，在视口上通常显示到 1920px 左右，
 * 所以 26px 源像素 ≈ 屏幕上 9px 的柔和过渡 —— 足以吃掉硬边，又不会让
 * 人物显得虚。
 *
 * 幂等性：本脚本会覆盖原文件。要重跑请先备份，或把半径调小（多次羽化会
 * 越跑越软）。建议只跑一次，然后把结果提交进仓库。
 *
 * pngjs 从 profile 的 node_modules 解析（见 PNGJS_CANDIDATES）—— 这是
 * 维护者工具，不进包依赖。
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const PNGJS_CANDIDATES = [
  "C:/Users/半秋/.dsh/profiles/desktop/node_modules/pngjs/lib/png.js",
];

const radius = Number(process.argv[2] ?? 26);
const dir = process.argv[3] ?? "assets";
const TARGETS = ["figure-spring.png", "figure-snow.png", "scene-spring.png", "scene-snow.png"];

if (!Number.isInteger(radius) || radius < 1 || radius > 200) {
  console.error("半径必须是 1..200 的整数");
  process.exit(2);
}

const require = createRequire(import.meta.url);
let pngjs = null;
for (const candidate of PNGJS_CANDIDATES) {
  if (existsSync(candidate)) {
    pngjs = require(candidate);
    break;
  }
}
if (pngjs === null) {
  console.error("找不到 pngjs，请修改 PNGJS_CANDIDATES");
  process.exit(3);
}

/**
 * 对单通道 Float32 数组做两次盒式模糊，近似高斯。
 * 分成行/列两趟（可分离卷积），复杂度 O(w·h·r) 而不是 O(w·h·r²)。
 */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = 2 * r + 1;

  // 横向
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      const outIdx = row + Math.min(w - 1, Math.max(0, x - r));
      const inIdx = row + Math.min(w - 1, Math.max(0, x + r + 1));
      sum += src[inIdx] - src[outIdx];
    }
  }

  // 纵向
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      const outIdx = Math.min(h - 1, Math.max(0, y - r)) * w + x;
      const inIdx = Math.min(h - 1, Math.max(0, y + r + 1)) * w + x;
      sum += tmp[inIdx] - tmp[outIdx];
    }
  }
  return out;
}

let failures = 0;
for (const name of TARGETS) {
  const path = join(dir, name);
  if (!existsSync(path)) {
    console.log(`跳过（不存在）: ${name}`);
    continue;
  }

  const png = pngjs.PNG.sync.read(readFileSync(path));
  const { width: w, height: h, data } = png;

  // 抽出 alpha
  const alpha = new Float32Array(w * h);
  for (let i = 0, p = 3; i < alpha.length; i++, p += 4) alpha[i] = data[p];

  // 两次盒式模糊 ≈ 高斯
  let blurred = boxBlur(alpha, w, h, radius);
  blurred = boxBlur(blurred, w, h, radius);

  // 写回 alpha
  for (let i = 0, p = 3; i < blurred.length; i++, p += 4) {
    data[p] = Math.max(0, Math.min(255, Math.round(blurred[i])));
  }

  const out = pngjs.PNG.sync.write(png);
  copyFileSync(path, `${path}.orig`);
  writeFileSync(path, out);

  // 统计：有多少像素的 alpha 落在"部分透明"区间（羽化带宽度）
  let feathered = 0;
  for (let i = 0; i < blurred.length; i++) {
    const a = blurred[i];
    if (a > 8 && a < 247) feathered++;
  }
  const pct = ((feathered / (w * h)) * 100).toFixed(2);
  console.log(
    `${name.padEnd(20)} ${w}x${h}  半径 ${radius}px  羽化像素 ${pct}%  ` +
      `${(readFileSync(path).length / 1024 / 1024).toFixed(2)}MB（原文件已备份为 .orig）`,
  );
}

console.log(failures === 0 ? "\n完成。确认效果后请删除 *.orig 备份。" : `\n${failures} 项失败`);
