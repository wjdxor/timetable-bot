require('dotenv').config();
const https = require('https');
const Timetable = require('./comcigan');

const SCHOOL_CODE = 78688;
const GRADE = 2;
const CLASS = 3;
const TEACHER_NAME = '임정'; // 부분 일치로 검색

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const PERIODS = ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시', '7교시'];
const WEEKDAYS_KR = ['월', '화', '수', '목', '금'];

function getTodayIndex() {
  // 한국 시간 기준 요일 (월=0 ~ 금=4)
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return now.getDay() - 1; // 일=−1, 월=0, ..., 금=4, 토=5
}

function getTodayDate() {
  return new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });
}

async function sendTelegram(text) {
  const body = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const parsed = JSON.parse(data);
          if (!parsed.ok) reject(new Error(`텔레그램 오류: ${parsed.description}`));
          else resolve(parsed);
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const dayIdx = getTodayIndex();

  if (dayIdx < 0 || dayIdx > 4) {
    console.log('오늘은 주말입니다. 시간표 전송 건너뜀.');
    return;
  }

  console.log(`${getTodayDate()} 시간표 조회 중...`);

  const tt = new Timetable();
  await tt.init();
  tt.setSchool(SCHOOL_CODE);
  const result = await tt.getTimetable();

  const today = WEEKDAYS_KR[dayIdx];
  const dateStr = getTodayDate();

  // ── 2-3반 시간표 ──
  const classTimetable = result[GRADE] && result[GRADE][CLASS] && result[GRADE][CLASS][dayIdx];

  let classRows = '';
  if (classTimetable && classTimetable.length > 0) {
    classTimetable.forEach((p, i) => {
      if (p && p.subject) {
        classRows += `  ${PERIODS[i]}: ${p.subject} (${p.teacher})\n`;
      }
    });
  }
  if (!classRows) classRows = '  등록된 수업 없음\n';

  // ── 임정* 선생님 시간표 ──
  const teacherRows = [];
  for (const g of Object.keys(result)) {
    for (const c of Object.keys(result[g])) {
      const dayData = result[g][c][dayIdx];
      if (!dayData) continue;
      dayData.forEach((p, i) => {
        if (p && p.teacher && p.teacher.includes(TEACHER_NAME)) {
          teacherRows.push({ period: i, grade: Number(g), cls: Number(c), subject: p.subject });
        }
      });
    }
  }
  teacherRows.sort((a, b) => a.period - b.period);

  let teacherSection = '';
  if (teacherRows.length > 0) {
    teacherRows.forEach(({ period, grade, cls, subject }) => {
      teacherSection += `  ${PERIODS[period]}: ${grade}-${cls}반 ${subject}\n`;
    });
  } else {
    teacherSection = '  수업 없음\n';
  }

  const message =
    `📅 <b>${dateStr}</b>\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📚 <b>2학년 3반 오늘 시간표</b>\n` +
    classRows +
    `\n👩‍🏫 <b>임정* 선생님 오늘 시간표</b>\n` +
    teacherSection;

  console.log(message.replace(/<[^>]+>/g, ''));
  await sendTelegram(message);
  console.log('✅ 텔레그램 전송 완료');
}

main().catch((err) => {
  console.error('오류:', err.message);
  process.exit(1);
});
