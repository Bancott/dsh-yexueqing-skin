/**
 * Host 半的冒烟测试：不依赖 DSH 运行时，用一个最小的 ctx 替身把
 * `apply()` 装起来，直接驱动 HTTP 处理器。
 *
 * 覆盖：
 *   1. 只注册真实存在的素材（缺失的缩略图/woff2 不产生路由）
 *   2. 字体在不接受 br 时按原始字节 + Content-Length 下发
 *   3. 字体在接受 br 时下发 brotli，且**解压后与原始文件逐字节相等**
 *   4. Range 请求走原始字节流并返回 206 + Content-Range
 *   5. 未知路径 404、非 GET/HEAD 405、ETag 命中 304
 *
 * 用法: node scripts/smoke-host.mjs
 */
import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { apply, inject } from "../index.js";

let failures = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 最小 ctx 替身 ────────────────────────────────────────────────────────

const routes = new Map();
const disposers = [];
const ctx = {
  effect(fn, _label) {
    const dispose = fn();
    if (typeof dispose === "function") disposers.push(dispose);
    return dispose;
  },
  webServer: {
    register(route) {
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    },
  },
};

check("inject 声明 webServer 硬依赖", Array.isArray(inject) && inject.includes("webServer"));
apply(ctx, {});
console.log(`\n注册路由 ${routes.size} 条:`);
for (const path of routes.keys()) console.log(`   ${path}`);

// ── 请求/响应替身 ────────────────────────────────────────────────────────

/**
 * 请求/响应替身。
 *
 * res 必须是一个**真的** Writable：处理器里用 `stream.pipe(res)` 下发大文件，
 * pipe 需要完整的 Writable 接口（on/once/emit/write/end/destroy），
 * 手写的伪对象会在 `dest.on is not a function` 处炸掉。
 * 这里只在真 Writable 上补 HTTP 语义的 `writeHead`，并把输出收集起来。
 */
function makeRes() {
  const chunks = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });

  const finished = new Promise((resolve) => {
    sink.once("finish", resolve);
    sink.once("close", resolve);
    sink.once("error", resolve);
  });

  const writeHead = function writeHead(status, headers = {}) {
    res.status = status;
    res.headers = headers;
    res.headersSent = true;
    return res;
  };

  const res = Object.assign(sink, {
    status: 0,
    headers: {},
    headersSent: false,
    writeHead,
    getBody: () => Buffer.concat(chunks),
    done: () => finished,
  });

  return res;
}

async function request(path, { method = "GET", headers = {} } = {}) {
  const route = routes.get(path);
  if (route === undefined) return { status: 404, headers: {}, body: null };
  const res = makeRes();
  route.handler({ method, url: path, headers }, res);
  await res.done();
  return { status: res.status, headers: res.headers, body: res.getBody() };
}

const FONT_PATH = "/plugins/yexueqing-skin/assets/LXGWWenKaiGB-Regular.subset.ttf";
const SPRING_PATH = "/plugins/yexueqing-skin/assets/skin-spring.jpg";
const fontOnDisk = readFileSync(fileURLToPath(new URL("../assets/LXGWWenKaiGB-Regular.subset.ttf", import.meta.url)));

async function main() {
  console.log("\n[1] 路由集合");
  check("立绘 spring 已注册", routes.has(SPRING_PATH));
  check("立绘 snow 已注册", routes.has("/plugins/yexueqing-skin/assets/skin-snow.jpg"));
  check("子集字体已注册", routes.has(FONT_PATH));
  check(
    "缺失的 woff2 未注册",
    !routes.has("/plugins/yexueqing-skin/assets/LXGWWenKaiGB-Regular.subset.woff2"),
  );
  check("缺失的缩略图未注册", !routes.has("/plugins/yexueqing-skin/assets/skin-spring.thumb.webp"));

  console.log("\n[2] 字体：identity 表示");
  {
    const res = await request(FONT_PATH);
    check("状态 200", res.status === 200, `得到 ${res.status}`);
    check("无 Content-Encoding", res.headers["Content-Encoding"] === undefined);
    check(
      "Content-Length 等于文件大小",
      res.headers["Content-Length"] === String(fontOnDisk.length),
      `${res.headers["Content-Length"]} vs ${fontOnDisk.length}`,
    );
    check("Accept-Ranges: bytes", res.headers["Accept-Ranges"] === "bytes");
    check("Vary 含 Accept-Encoding", String(res.headers.Vary).includes("Accept-Encoding"));
    check("body 与源文件逐字节相等", res.body.equals(fontOnDisk));
  }

  console.log("\n[3] 字体：brotli 表示与完整性");
  {
    const res = await request(FONT_PATH, { headers: { "accept-encoding": "gzip, br" } });
    check("状态 200", res.status === 200, `得到 ${res.status}`);
    check("Content-Encoding: br", res.headers["Content-Encoding"] === "br");
    const body = res.body;
    check("压缩后体积更小", body.length < fontOnDisk.length, `${body.length} vs ${fontOnDisk.length}`);
    check("Content-Length 等于压缩后字节数", res.headers["Content-Length"] === String(body.length));

    let roundTrip = null;
    try {
      roundTrip = brotliDecompressSync(body);
    } catch (error) {
      check("brotli 可解压", false, error.message);
    }
    if (roundTrip !== null) {
      check("解压后与原始文件逐字节相等", roundTrip.equals(fontOnDisk));
    }
    console.log(
      `     原始 ${(fontOnDisk.length / 1024 / 1024).toFixed(2)} MB → 传输 ` +
        `${(body.length / 1024 / 1024).toFixed(2)} MB ` +
        `(${(100 - (body.length / fontOnDisk.length) * 100).toFixed(1)}% 节省)`,
    );

    console.log("\n[3b] 压缩表示的 ETag 复用 / HEAD");
    const cached = await request(FONT_PATH, {
      headers: { "accept-encoding": "br", "if-none-match": res.headers.ETag },
    });
    check("命中 304", cached.status === 304, `得到 ${cached.status}`);
    check("304 带 Vary", String(cached.headers.Vary).includes("Accept-Encoding"));

    const head = await request(FONT_PATH, { method: "HEAD", headers: { "accept-encoding": "br" } });
    check("HEAD 返回 200 且无 body", head.status === 200 && head.body.length === 0,
      `status=${head.status} bodyLen=${head.body.length}`);

    const headRange = await request(FONT_PATH, { method: "HEAD", headers: { range: "bytes=0-99" } });
    check("HEAD + Range 返回 206 且无 body", headRange.status === 206 && headRange.body.length === 0);
  }

  console.log("\n[4] Range 请求");
  {
    const res = await request(FONT_PATH, { headers: { range: "bytes=0-99" } });
    check("状态 206", res.status === 206, `得到 ${res.status}`);
    check("Content-Range 正确", res.headers["Content-Range"] === `bytes 0-99/${fontOnDisk.length}`);
    check("Content-Length 为 100", res.headers["Content-Length"] === "100");
    check("Range 请求不返回 br", res.headers["Content-Encoding"] === undefined);
    check("字节内容与源文件一致", res.body.equals(fontOnDisk.subarray(0, 100)));

    const tail = await request(FONT_PATH, { headers: { range: "bytes=-64" } });
    check("后缀 Range 可用", tail.status === 206 && tail.body.equals(fontOnDisk.subarray(-64)),
      `status=${tail.status} len=${tail.body.length}`);

    const bad = await request(FONT_PATH, { headers: { range: "bytes=99999999-" } });
    check("越界 Range 返回 416", bad.status === 416, `得到 ${bad.status}`);

    const multi = await request(FONT_PATH, { headers: { range: "bytes=0-9,20-29" } });
    check("多段 Range 被拒绝", multi.status === 416, `得到 ${multi.status}`);
  }

  console.log("\n[5] 错误路径");
  {
    const missing = await request("/plugins/yexueqing-skin/assets/nope.png");
    check("未知素材 404", missing.status === 404);
    const method = await request(FONT_PATH, { method: "POST" });
    check("POST 返回 405", method.status === 405, `得到 ${method.status}`);
    const identity = await request(FONT_PATH);
    const notModified = await request(FONT_PATH, { headers: { "if-none-match": identity.headers.ETag } });
    check("identity ETag 命中 304", notModified.status === 304, `得到 ${notModified.status}`);
  }

  console.log("\n[6] 卸载幂等");
  {
    for (const dispose of disposers) dispose();
    check("disposer 清空所有路由", routes.size === 0, `剩 ${routes.size} 条`);
  }

  console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
