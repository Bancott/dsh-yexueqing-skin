/**
 * 叶雪青主题皮肤 —— Host 半。
 *
 * 职责只有一件事：把这套装帧用到的静态素材（两张立绘、霞鹜文楷GB 字体）
 * 挂到浏览器 HTTP 载体上，供 Client 半的 `@font-face` 与背景层引用。
 *
 * 为什么必须走 Host：Client 半是浏览器里的纯 JS bundle，不能读磁盘，
 * 也不能打包 26 MB 的字体（那会让 bundle 体积与 HMR 成本失控）。
 * Web 载体已经提供 `ctx.webServer`，因此这里注册精确路径、
 * 交给 Client 半一个稳定 URL 前缀即可。
 *
 * 严格遵循 `cordis-plugin-development/references/host-plugin.md`：
 *   - 只导出 `apply` 与 `inject`，不混用 default 导出；
 *   - 所有资源都在 `apply` 内经 `ctx.effect` 注册，disposer 是运行时唯一的清理入口；
 *   - 不依赖任何第三方包，因此 bundle 无需 install script 或 build 步骤。
 */

import { createReadStream, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

/**
 * 素材路由前缀的默认值。
 * `cordis.patch.yml` 的 `assetBase` 可以覆盖它；Client 半使用同一字面量
 * （见 `client.js` 顶部的 `ASSET_BASE`），改动时必须两处同步。
 */
const DEFAULT_ASSET_BASE = "/plugins/yexueqing-skin/assets/";

/**
 * 素材表：文件名 -> MIME 类型。
 *
 * 每一项都是可选的：文件不存在时该条目不注册，浏览器侧按声明顺序回退，
 * 而不是让整个插件激活失败。因此删掉任意一张图都能优雅降级。
 *
 * 每个皮肤三张画面素材，构成"背景画面 + 前景抠图"的分层：
 *   skin-<id>.jpg      原图铺满，负责环境氛围（上面的层会把它压暗）
 *   scene-<id>.png     抠出的重要背景（紫藤 / 花枝）
 *   figure-<id>.png    抠出的人物，**不受晕影遮挡**，边缘自带渐入
 *
 * 抠图是 RGBA PNG —— 真实透明通道，不是靠颜色近似，
 * 因此人物可以完整压在晕影之上而不带白边。
 *
 * 字体说明：随包发布的是**子集化**后的
 * `LXGWWenKaiGB-Regular.subset.ttf`（24.6 MB -> 3.62 MB，见
 * `scripts/subset-font.mjs`），覆盖 GB2312 全集 + 拉丁 + 标点 + 常用符号；
 * 集合外的字符由字体栈末尾的系统字体承接。
 * `.woff2` 是可选优化产物 —— 存在时 `@font-face` 优先取它。
 */
const ASSET_SPECS = [
  ["skin-spring.jpg", "image/jpeg"],
  ["skin-snow.jpg", "image/jpeg"],
  ["scene-spring.png", "image/png"],
  ["scene-snow.png", "image/png"],
  ["figure-spring.png", "image/png"],
  ["figure-snow.png", "image/png"],
  ["LXGWWenKaiGB-Regular.subset.woff2", "font/woff2"],
  ["LXGWWenKaiGB-Regular.subset.ttf", "font/ttf"],
];


/** 写出一个无 body 的响应。 */
function send(res, status, headers = {}) {
  res.writeHead(status, {
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end();
}

/**
 * 解析单段 `Range: bytes=a-b` 请求头。
 *
 * @returns `null` 表示没有 Range（整体响应），`false` 表示无法满足（416），
 *          否则返回夹取后的 `{ start, end }`。多段 Range 按规格应当拒绝，
 *          这里与浏览器对媒体/字体的实际用法保持一致：只服务单段。
 */
function parseSingleRange(header, size) {
  if (typeof header !== "string" || !header.startsWith("bytes=")) return null;
  const spec = header.slice("bytes=".length).trim();
  if (spec.includes(",")) return false;

  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (match === null) return false;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return false;

  let start;
  let end;
  if (rawStart === "") {
    // 后缀范围：最后 N 字节。
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return false;
    if (start > end) return false;
    if (start >= size) return false;
    end = Math.min(end, size - 1);
  }

  return { start, end };
}

/**
 * 建立素材索引。用 `node:fs` 直接探测，避免为一个静态目录引入打包器：
 * 文件在安装时才存在，索引用 stat 一次，之后每次请求复用。
 */
function buildAssets(assetBase) {
  const assets = new Map();
  // index.js 位于包根，因此素材目录是同级目录 `./assets/`。
  const directory = new URL("./assets/", import.meta.url);

  for (const [name, type] of ASSET_SPECS) {
    const url = new URL(name, directory);
    const path = fileURLToPathSafe(url);
    if (path === undefined) continue;
    const info = statSafe(path);
    if (info === undefined || !info.isFile()) continue;
    assets.set(assetBase + name, {
      path,
      type,
      size: info.size,
      mtimeMs: info.mtimeMs,
      etag: `W/"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`,
      // 惰性字段：`undefined` = 尚未尝试压缩，`null` = 不值得压缩。
      br: undefined,
      brEtag: undefined,
    });
  }

  return assets;
}

/** `fileURLToPath` 的懒加载包装：Host 半在无 Web 载体时不应因 import 失败而崩。 */
function fileURLToPathSafe(url) {
  try {
    return fileURLToPath(url);
  } catch {
    return undefined;
  }
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

/**
 * 字体的 brotli 预压缩表示，惰性计算一次并缓存。
 *
 * 为什么值得：3.62 MB 的子集字体用 brotli 大约能压到一半，而字体是
 * "下过一次就强缓存" 的资源，所以在第一次字体请求时花一次 CPU、
 * 之后所有请求（含每次刷新）都直接拿缓存字节，是稳赚的。
 *
 * 为什么惰性而不是激活时算：激活时压缩会阻塞宿主事件循环 1 秒以上，
 * 而用户可能根本没开字体开关。放进请求路径后，没开开关的部署零成本。
 *
 * @returns 压缩后的 Buffer，压不下来或出错时 `null`（此时回退到原始字节流）。
 */
function ensureBrotli(asset) {
  if (asset.br !== undefined) return asset.br;

  try {
    const raw = readFileSync(asset.path);
    const compressed = brotliCompressSync(raw, {
      params: {
        // 质量 9：相比 11 快一个数量级，体积只差几个百分点。
        [zlibConstants.BROTLI_PARAM_QUALITY]: 9,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    });
    if (compressed.length < raw.length) {
      asset.br = compressed;
      // 压缩表示与原始表示是两个 representation，必须有各自的 ETag。
      asset.brEtag = `W/"br-${compressed.length.toString(16)}-${Math.trunc(asset.mtimeMs).toString(16)}"`;
    } else {
      asset.br = null;
    }
  } catch {
    asset.br = null;
  }

  return asset.br;
}

/**
 * 构造精确路径的素材处理器。
 *
 * 支持 `GET`/`HEAD`、`ETag` 条件请求与 `Range` 断点续传 —— 字体与
 * 大尺寸立绘都由浏览器缓存，这两项是必要的：没有 `ETag` 会造成每次
 * 刷新重新拉 26 MB 字体，没有 `Range` 会让字体加载在同源策略下退化。
 */
function createAssetHandler(assets, activeStreams) {
  return (req, res) => {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      send(res, 405, { Allow: "GET, HEAD" });
      return;
    }

    let pathname;
    try {
      pathname = new URL(req.url ?? "/", "http://dsh.local").pathname;
    } catch {
      send(res, 404);
      return;
    }

    const asset = assets.get(pathname);
    if (asset === undefined) {
      send(res, 404);
      return;
    }

    // 字体的 brotli 表示优先：整段下发，不走 Range（字体总是整份请求的）。
    // 带 Range 的请求一律走下面的原始字节流路径，避免
    // Content-Encoding 与字节区间语义打架。
    const brotli =
      asset.type.startsWith("font/") &&
      req.headers.range === undefined &&
      /\bbr\b/.test(String(req.headers["accept-encoding"] ?? ""))
        ? ensureBrotli(asset)
        : null;

    if (brotli !== null) {
      if (req.headers["if-none-match"] === asset.brEtag) {
        send(res, 304, { ETag: asset.brEtag, Vary: "Accept-Encoding" });
        return;
      }
      const brHeaders = {
        "Cache-Control": "public, max-age=604800, immutable",
        "Content-Encoding": "br",
        "Content-Length": String(brotli.length),
        "Content-Type": asset.type,
        ETag: asset.brEtag,
        // 同一 URL 有两个 representation，缓存必须按编码分流。
        Vary: "Accept-Encoding",
      };
      if (method === "HEAD") {
        send(res, 200, brHeaders);
        return;
      }
      res.writeHead(200, { "X-Content-Type-Options": "nosniff", ...brHeaders });
      res.end(brotli);
      return;
    }

    if (req.headers["if-none-match"] === asset.etag) {
      send(res, 304, { ETag: asset.etag });
      return;
    }

    const ifRange = req.headers["if-range"];
    const rangeHeader =
      ifRange !== undefined && ifRange !== asset.etag ? undefined : req.headers.range;
    const range = parseSingleRange(rangeHeader, asset.size);
    if (range === false) {
      send(res, 416, { "Content-Range": `bytes */${asset.size}` });
      return;
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? asset.size - 1;
    const status = range === null ? 200 : 206;
    const headers = {
      "Accept-Ranges": "bytes",
      // 素材随包发布、文件名即版本，因此允许长时间强缓存。
      "Cache-Control": "public, max-age=604800, immutable",
      "Content-Length": String(end - start + 1),
      "Content-Type": asset.type,
      ETag: asset.etag,
      // 同一 URL 存在 br 与 identity 两个 representation。
      Vary: "Accept-Encoding",
      ...(range === null ? {} : { "Content-Range": `bytes ${start}-${end}/${asset.size}` }),
    };

    if (method === "HEAD") {
      send(res, status, headers);
      return;
    }

    res.writeHead(status, { "X-Content-Type-Options": "nosniff", ...headers });

    const stream = createReadStream(asset.path, { start, end });
    activeStreams.add(stream);
    const release = () => activeStreams.delete(stream);
    stream.once("close", release);
    stream.once("end", release);
    stream.once("error", () => {
      release();
      if (!res.headersSent) send(res, 500);
      else res.destroy();
    });
    // 浏览器中断加载（例如切换皮肤变体）时必须销毁底层 fd，否则会泄漏句柄。
    res.once("close", () => {
      if (!stream.destroyed) stream.destroy();
    });
    stream.pipe(res);
  };
}

/**
 * Host 半的硬依赖：没有 HTTP 载体就没有素材路由，插件应当保持未激活
 * 而不是抛错 —— 这正是 `inject` 的语义。
 */
export const inject = ["webServer"];

export function apply(ctx, config) {
  const assetBase =
    typeof config?.assetBase === "string" && config.assetBase.length > 0
      ? config.assetBase
      : DEFAULT_ASSET_BASE;

  if (config?.enabled === false) return;

  const assets = buildAssets(assetBase);
  const activeStreams = new Set();

  ctx.effect(() => {
    const handler = createAssetHandler(assets, activeStreams);
    const disposers = [...assets.keys()].map((path) =>
      ctx.webServer.register({ kind: "exact", path, handler }),
    );


    return () => {
      for (const dispose of disposers) dispose();
      // 插件卸载后仍在传输的字节流必须断开，否则卸载不是幂等的。
      for (const stream of activeStreams) stream.destroy();
      activeStreams.clear();
    };
  }, "yexueqing-skin: 静态素材路由");
}
