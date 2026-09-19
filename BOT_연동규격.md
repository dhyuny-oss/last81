# 알파터미널 봇 연동 규격 (v1)

외부 AI 봇(그록 등)이 읽어서 알림을 만들 수 있는 공개 데이터 목록입니다.
전부 **읽기 전용 JSON**이고 인증이 필요 없습니다. 호출 비용도 없습니다.

## 1. 주소

| 주소 | 내용 | 갱신 |
|---|---|---|
| https://last81.vercel.app/data/snapshot.json | 종목·ETF 지표와 매매 신호 | 하루 2회 (16:17 / 06:23 KST) |
| https://last81.vercel.app/data/market.json | 지수·섹터·시장판정·DC 규칙 | 하루 2회 |
| https://last81.vercel.app/data/data_health.json | 데이터 검사 결과(제외 종목 등) | 하루 2회 |
| https://last81.vercel.app/data/universe_log.json | 주간 종목풀 변경 | 주 1회(토) |
| https://last81.vercel.app/data/bars/TICKER.json | 그 종목 최근 200봉 | 하루 2회 |
| https://last81.vercel.app/data/watchlist.json | 내 보유·관심 (앱에서 '알림 연결' 시) | 누를 때 |

## 2. 종목 한 건의 모양 (snapshot.json → stocks)

```json
{
  "t": "214370",
  "n": "케어젠",
  "m": "kr",
  "s": "",
  "c": 39900.0,
  "d1": -2.21,
  "d3": -3.51,
  "d5": -4.32,
  "d21": -26.11,
  "rsi": 25.91,
  "macdH": -118.7527,
  "st": 0,
  "cloud": -1,
  "tv": 2989029710,
  "ma200p": -51.66,
  "w52p": -74.06,
  "tmpl": false,
  "brk": false,
  "hlt": 0.53,
  "hltY": 3.0,
  "bars": 1000,
  "asOf": "2026-09-18",
  "stFlip": false,
  "stSlow": 0,
  "stLine": 48307.0,
  "slowDays": 13,
  "rsiUp": false,
  "macdUp": true,
  "ex": ".KQ",
  "rs": 2.6,
  "tvr": 25.6,
  "pull": false,
  "sig": "exit"
}
```

핵심 필드
- `sig` : `buy`(매수신호) / `exit`(추세이탈=매도) / `keep`(유지)
- `pull` : true 면 ⭐눌림신호 (검증에서 가장 강했던 진입)
- `stSlow` : 1=느린 슈퍼트렌드 초록, 0=빨강
- `stLine` : **트레일링 손절선 가격** — 종가가 이 아래면 매도
- `slowDays` : 지금 색이 된 뒤 경과 거래일
- `rs` : 같은 시장 6개월 상대강도 백분위(100이 최고)
- `tvr` : 거래대금 백분위 (40 미만은 앱에서 제외)
- `c`/`d1`/`d3`/`d5`/`d21` : 종가와 1·3·5일·1달 누적 등락(%)
- `m` : `kr`/`us`, `ex` : `.KS`(코스피)/`.KQ`(코스닥)/`NMS`(나스닥)/`NYQ`(뉴욕)

## 3. ETF (snapshot.json → etfs)

```json
{
  "t": "SPY",
  "n": "S&P500 (SPY)",
  "c": 761.69,
  "stSlow": 0,
  "stLine": 775.2,
  "slowDays": 3,
  "score": 11.3,
  "veh": {
    "code": "360750",
    "name": "TIGER 미국S&P500",
    "synth": false,
    "c": 26280.0,
    "d1": 0.86,
    "d21": -1.46,
    "asOf": "2026-09-18"
  }
}
```
`veh` 는 DC(퇴직연금)에서 실제로 살 국내 상장 ETF입니다.

## 4. 시장 (market.json)

- `judge.kr.verdict` / `judge.us.verdict` : `safe` / `warn` / `risk`
- `indices["^GSPC"|"^IXIC"|"^KS11"].d21` : 지수 1달 등락 (시장대비 계산용)
- `dc.core[].state` : `hold`(보유) / `wait`(안전자산)
- `sectors[]` : 섹터 순위와 점수

## 5. 봇에게 시키기 좋은 일 / 시키면 안 되는 일

**좋은 일 — 장중 가격 감시 (앱이 못 하는 것)**
1. 시간마다 `snapshot.json`에서 내가 보유한 종목의 `stLine`(트레일링 손절선)을 읽는다
2. 현재가를 어디서든 받아 `stLine` 과 비교한다
3. 현재가가 `stLine` 아래로 내려가면 "종가까지 지켜보고, 이 아래로 마감하면 매도" 라고 알린다

이건 유용합니다. 앱은 하루 2번만 보기 때문에 장중에 선이 깨지는 걸 모릅니다.

**시키면 안 되는 일 — 장중 지표로 매매 신호 새로 만들기**
- 이 앱의 신호는 전부 **종가 기준**으로 검증했습니다(2008~2026).
- 봇이 장중 가격으로 RSI·슈퍼트렌드를 다시 계산하면 **다른 신호**가 나오고, 그 신호는 검증된 적이 없습니다.
- 검증에서 장 마감 직후 서둘러 사는 것은 다음날 종가 매수보다 나빴습니다(+2.73% vs +3.00%).

**의미 없는 일**
- 하루 2번만 갱신되므로, 같은 파일을 시간마다 다시 읽어도 새 신호는 없습니다.
- 봇이 읽을 값이 바뀌는 시각은 **16:17 이후, 06:23 이후** 두 번뿐입니다.

## 6. 봇 프롬프트 예시

```
매시 정각에 https://last81.vercel.app/data/watchlist.json 의 positions 를 읽고,
각 종목 t 에 대해 https://last81.vercel.app/data/snapshot.json 에서 stLine 과 stSlow 를 찾아라.
현재가를 조회해 stLine 보다 낮으면 "[종목명] 트레일링선 이탈 — 종가 확인 필요" 라고 알려라.
stSlow 가 0 이면 이미 매도 신호이므로 "이미 매도 신호" 라고 덧붙여라.
신호를 새로 계산하지 말고, 위 값만 그대로 사용하라.
```

## 7. 쓰기는 막혀 있습니다

`/api/watchlist` 와 `/api/refresh` 는 암호(x-key)가 있어야 동작합니다. 봇에는 **읽기 주소만** 주세요.
