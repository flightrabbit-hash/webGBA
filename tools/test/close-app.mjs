// 시험으로 띄운 webGBA 를 정상 닫기 경로(window_close)로 닫는다.
//   node tools/test/close-app.mjs <CDP 포트>
import { connect, sleep } from "./cdp.mjs";

const port = Number(process.argv[2] ?? 9335);
const app = await connect(port, { timeoutMs: 5000 });
await Promise.race([app.evaluate("window.__TAURI__.core.invoke('window_close')").catch(() => {}), sleep(1500)]);
app.close();
console.log("닫기를 보냈습니다");
