// 터미널 출력 색상. 색상 문자(ANSI)가 섞이면 로그 검색이 어려우므로, 각 스크립트는
// 색상을 제거한 원문을 파일 상단 주석에 기록한다.
//
// 터미널이 아닐 때(파일·파이프 수신)와 `NO_COLOR` 지정 시에는 색상을 넣지 않는다 —
// 리다이렉션한 파일에 제어 문자가 남으면 `grep` 결과가 어긋난다.

const on = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const paint = (code) => (text) => (on ? `\u001b[${code}m${text}\u001b[0m` : String(text));

module.exports = {
  on,
  /** 제목·머리글 */
  head: paint("1;36"),
  /** 분류·항목명 */
  name: paint("36"),
  /** 수치·용량 */
  num: paint("35"),
  /** 정상 */
  ok: paint("32"),
  /** 주의 */
  warn: paint("33"),
  /** 실패 */
  bad: paint("31"),
  /** 부가 정보 */
  dim: paint("90"),
};
