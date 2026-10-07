/**
 * 霞鹜文楷GB 子集化脚本。
 *
 * 全量 TTF 是 24.6 MB：字体本身覆盖 GB18030，BMP 内就有 4.3 万个字形。
 * 对一个 UI 皮肤来说这远超需要 —— 界面文字全部落在
 * 「GB2312 常用字 + 拉丁 + 标点 + 全角形式 + 常用符号」这一集合里。
 *
 * 本脚本按下面的字符集子集化，其余字符由字体栈末尾的系统字体
 * （PingFang SC / 微软雅黑）回退承接，这是 webfont 的标准做法：
 * `--dsw-font-family` 的值形如 `"LXGW WenKai GB", <原生系统字体栈>`，
 * 因此回退是无感的。
 *
 * 用法：
 *   node scripts/subset-font.mjs <源.ttf> <目标.ttf>
 *
 * fontkit 从 DSH 安装目录的 unpacked node_modules 解析（见 FONTKIT_CANDIDATES）；
 * 换机器时改这一处即可。
 */
import { createRequire } from "node:module";
import { statSync, writeFileSync } from "node:fs";

const FONTKIT_CANDIDATES = [
  "D:/Programs/DeepSeek Harness/resources/app.asar.unpacked/dsh/node_modules/fontkit/dist/main.cjs",
];

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  console.error("用法: node subset-font.mjs <源.ttf> <目标.ttf>");
  process.exit(2);
}

// ── 字符集 ────────────────────────────────────────────────────────────────

/** 逐码位收录的区间。UI 里真正会出现的符号都在这里。 */
const CODE_POINT_RANGES = [
  [0x0020, 0x007e], // Basic Latin
  [0x00a0, 0x00ff], // Latin-1 Supplement
  [0x0100, 0x017f], // Latin Extended-A
  [0x0180, 0x024f], // Latin Extended-B
  [0x0250, 0x02af], // IPA（音标，注释里偶尔出现）
  [0x02b0, 0x02ff], // Spacing Modifier Letters
  [0x0300, 0x036f], // Combining Diacritics
  [0x0370, 0x03ff], // Greek（数学/物理符号）
  [0x0400, 0x04ff], // Cyrillic
  [0x2000, 0x206f], // General Punctuation（—…""''）
  [0x2070, 0x209f], // Super/Subscripts
  [0x20a0, 0x20bf], // Currency Symbols（￥€$）
  [0x2100, 0x214f], // Letterlike Symbols（™№）
  [0x2150, 0x218f], // Number Forms（½⅓）
  [0x2190, 0x21ff], // Arrows（→←↑↓）
  [0x2200, 0x22ff], // Mathematical Operators（≈≠≤≥）
  [0x2460, 0x24ff], // Enclosed Alphanumerics（①②）
  [0x2500, 0x257f], // Box Drawing
  [0x2580, 0x259f], // Block Elements（进度条块）
  [0x25a0, 0x25ff], // Geometric Shapes（●■▲）
  [0x2600, 0x26ff], // Miscellaneous Symbols（★☆）
  [0x2700, 0x27bf], // Dingbats（✓✗）
  [0x3000, 0x303f], // CJK Symbols and Punctuation（、。「」）
  [0x3040, 0x30ff], // Hiragana + Katakana（日文界面/文档）
  [0xff00, 0xffef], // Halfwidth and Fullwidth Forms
  [0xfe10, 0xfe1f], // Vertical Forms
  [0xfe30, 0xfe4f], // CJK Compatibility Forms
];

/**
 * GB2312 全集：一级 + 二级汉字（6763 字）与 682 个图形符号。
 * 这是「现代中文界面用字」的标准闭集，覆盖日常文本的 99.7% 以上。
 */
function gb2312CodePoints() {
  const decoder = new TextDecoder("gbk");
  const points = new Set();
  for (let lead = 0xa1; lead <= 0xf7; lead++) {
    for (let trail = 0xa1; trail <= 0xfe; trail++) {
      const text = decoder.decode(new Uint8Array([lead, trail]));
      if (text.length !== 1) continue;
      const codePoint = text.codePointAt(0);
      // 替换字符说明该字节对在 GBK 里无效。
      if (codePoint === 0xfffd) continue;
      points.add(codePoint);
    }
  }
  return points;
}

const wanted = new Set();
for (const [start, end] of CODE_POINT_RANGES) {
  for (let cp = start; cp <= end; cp++) wanted.add(cp);
}
for (const cp of gb2312CodePoints()) wanted.add(cp);

// ── 子集化 ────────────────────────────────────────────────────────────────

const require = createRequire(import.meta.url);
let fontkit = null;
for (const candidate of FONTKIT_CANDIDATES) {
  try {
    statSync(candidate);
  } catch {
    continue;
  }
  fontkit = require(candidate);
  break;
}
if (fontkit === null) {
  console.error("找不到 fontkit，请修改 FONTKIT_CANDIDATES");
  process.exit(3);
}

console.log("打开:", source);
const font = fontkit.openSync(source);
console.log("postscriptName:", font.postscriptName, "| unitsPerEm:", font.unitsPerEm);
console.log("请求码位:", wanted.size);

const subset = font.createSubset();
let included = 0;
let missing = 0;
for (const codePoint of wanted) {
  const glyph = font.glyphForCodePoint(codePoint);
  // id 0 是 .notdef：字体没有这个字形，跳过而不是塞一个空壳。
  if (!glyph || glyph.id === 0) {
    missing++;
    continue;
  }
  subset.includeGlyph(glyph);
  included++;
}
console.log(`收录字形: ${included}（字体缺失 ${missing}）`);

const output = subset.encode();
const bytes =
  output instanceof Uint8Array
    ? output
    : output instanceof ArrayBuffer
      ? new Uint8Array(output)
      : // 某些 fontkit 版本返回可读流
        await new Promise((resolve, reject) => {
          const chunks = [];
          output.on("data", (chunk) => chunks.push(chunk));
          output.on("end", () => resolve(Buffer.concat(chunks)));
          output.on("error", reject);
        });

writeFileSync(target, bytes);
console.log(`写出: ${target} (${(bytes.length / 1024 / 1024).toFixed(2)} MB)`);
