// comcigan-parser (MIT) - https://github.com/leegeunhyeok/comcigan-parser
const request = require('request');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');

if (typeof URL === 'undefined') {
  URL = require('url').URL;
}

const HOST = 'http://컴시간학생.kr';

class Timetable {
  constructor() {
    this._baseUrl = null;
    this._url = null;
    this._initialized = false;
    this._pageSource = null;
    this._schoolCode = -1;
    this._weekdayString = ['일', '월', '화', '수', '목', '금', '토'];
    this._option = { maxGrade: 3, cache: 0 };
  }

  async init(option) {
    if (option) this._option = Object.assign(this._option, option);

    await new Promise((resolve, reject) => {
      request(HOST, (err, _res, body) => {
        if (err) return reject(err);
        const frame = body.toLowerCase().replace(/\'/g, '"').match(/<frame [^>]*src="[^"]*"[^>]*>/gm);
        if (!frame) return reject(new Error('frame을 찾을 수 없습니다'));
        const uri = frame[0].match(/\".*\"/gi);
        if (!uri) return reject(new Error('접근 주소를 찾을 수 없습니다'));
        const frameHref = uri[0].replace(/\"/g, '');
        const url = new URL(frameHref);
        this._url = frameHref;
        this._baseUrl = url.origin;
        resolve();
      });
    });

    await new Promise((resolve, reject) => {
      request({ url: this._url, encoding: null }, (err, _res, body) => {
        if (err) return reject(err);
        const source = iconv.decode(body, 'EUC-KR');
        const idx = source.indexOf('school_ra(sc)');
        const idx2 = source.indexOf("sc_data('");
        if (idx === -1 || idx2 === -1) return reject(new Error('소스에서 식별 코드를 찾을 수 없습니다.'));
        const extractSchoolRa = source.substr(idx, 50).replace(' ', '');
        const schoolRa = extractSchoolRa.match(/url:'.(.*?)'/);
        const extractScData = source.substr(idx2, 30).replace(' ', '');
        const scData = extractScData.match(/\(.*?\)/);
        if (scData) {
          this._scData = scData[0].replace(/[()]/g, '').replace(/'/g, '').split(',');
        } else {
          return reject(new Error('sc_data 값을 찾을 수 없습니다.'));
        }
        if (schoolRa) {
          this._extractCode = schoolRa[1];
        } else {
          return reject(new Error('school_ra 값을 찾을 수 없습니다.'));
        }
        this._pageSource = source;
        resolve();
      });
    });
    this._initialized = true;
  }

  setSchool(schoolCode) {
    this._schoolCode = schoolCode;
  }

  async getTimetable() {
    this._isReady();
    const jsonString = await this._getData();
    const resultJson = JSON.parse(jsonString);
    const startTag = this._pageSource.match(/<script language(.*?)>/gm)[0];
    const regex = new RegExp(startTag + '(.*?)</script>', 'gi');
    let match;
    let script = '';
    while ((match = regex.exec(this._pageSource))) script += match[1];

    const functioName = script.match(/function 자료[^\(]*/gm)[0].replace(/\+s/, '').replace('function', '');
    const classCount = resultJson['학급수'];
    const timetableData = {};

    for (let grade = 1; grade <= this._option['maxGrade']; grade++) {
      timetableData[grade] = {};
      for (let classNum = 1; classNum <= classCount[grade]; classNum++) {
        timetableData[grade][classNum] = this._getClassTimetable({ data: jsonString, script, functioName }, grade, classNum);
      }
    }
    return timetableData;
  }

  async _getData() {
    const da1 = '0';
    const s7 = this._scData[0] + this._schoolCode;
    const sc3 = this._extractCode.split('?')[0] + '?' + Buffer.from(s7 + '_' + da1 + '_' + this._scData[2]).toString('base64');
    return new Promise((resolve, reject) => {
      request(this._baseUrl + sc3, (err, _res, body) => {
        if (err) return reject(err);
        if (!body) return reject(new Error('시간표 데이터를 찾을 수 없습니다.'));
        resolve(body.substr(0, body.lastIndexOf('}') + 1));
      });
    });
  }

  _getClassTimetable(codeConfig, grade, classNumber) {
    const args = [codeConfig.data, grade, classNumber];
    const call = codeConfig.functioName + '(' + args.join(',') + ')';
    const script = codeConfig.script + '\n\n' + call;
    const res = eval(script);
    const $ = cheerio.load(res);
    const $this = this;
    const timetable = [];
    $('tr').each(function (timeIdx) {
      const currentTime = timeIdx - 2;
      if (timeIdx <= 1) return;
      $(this).find('td').each(function (weekDayIdx) {
        const currentWeekDay = weekDayIdx - 1;
        if (weekDayIdx === 0 || weekDayIdx === 6) return;
        if (!timetable[currentWeekDay]) timetable[currentWeekDay] = [];
        const subject = $(this).contents().first().text();
        const teacher = $(this).contents().last().text();
        timetable[currentWeekDay][currentTime] = {
          grade, class: classNumber,
          weekday: weekDayIdx - 1,
          weekdayString: $this._weekdayString[weekDayIdx],
          classTime: currentTime + 1,
          teacher, subject,
        };
      });
    });
    return timetable;
  }

  _isReady() {
    if (!this._initialized) throw new Error('초기화가 진행되지 않았습니다.');
    if (this._schoolCode === -1) throw new Error('학교 설정이 진행되지 않았습니다.');
  }
}

module.exports = Timetable;
