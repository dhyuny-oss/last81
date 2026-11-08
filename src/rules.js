/** 260. 매매 규칙 숫자 — config/rules.json 한 파일 (앱·서버·파이프라인 공통). 여기서는 읽어서 내보내기만 합니다 */
import R from "../config/rules.json" with { type: "json" };
export default R;
export const RULES = R;
