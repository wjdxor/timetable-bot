const request = require('request');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');
const vm = require('vm');

if (typeof URL === 'undefined') {
  URL = require('url').URL;
}

const HOST = 'http://컴시간학생.kr';

function makeSandbox() {
  const noop = () => {};
  const domStub = {};
  ['ready','on','off','each','find','html','text','val','css','attr','prop',
   'click','hide','show','append','prepend','remove','addClass','removeClass',
   'toggleClass','data','trigger','bind','unbind','submit','change','focus',
   'blur','keyup','keydown','mouseenter','mouseleave','hover','children','parent',
   'parents','closest','siblings','next','prev','eq','first','last','filter','not',
   'is','serialize','serializeArray','load','get','post','getJSON'].forEach(m => {
    domStub[m] = function(arg) {
      if (m === 'ready' && typeof arg === 'function') arg();
      return domStub;
    };
  });
  domStub.length = 0;
  domStub[0] = null;

  const $ = Object.assign(
    function(arg) { if (typeof arg === 'function') arg(); return domStub; },
    {
      ajax: noop, get: noop, post: noop, getJSON: noop,
      fn: domStub, extend: (a, b) => Object.assign(a || {}, b || {}),
      when: () => ({ done: () => ({}), fail: noop }),
      Deferred: () => ({ resolve: noop, reject: noop, promise: () => ({}) }),
      isArray: Array.isArray, isFunction: (f) => typeof f === 'function',
      trim: (s) => (s || '').trim(), each: noop, map: noop, grep: noop,
      inArray: () => -1, noop,
    }
  );

  const docStub = {
    getElementById: () => null, getElementsByTagName: () => [],
    getElementsByClassName: () => [], querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, innerHTML: '', value: '', appendChild: noop, setAttribute: noop, getAttribute: () => null }),
    createTextNode: () => ({}),
    body: { appendChild: noop, style: {}, innerHTML: '' },
    head: { appendChild: noop },
    addEventListener: noop, removeEventListener: noop,
    cookie: '', readyState: 'complete', title: '',
    location: { href: '', search: '', hash: '', pathname: '/' },
  };

  const sandbox = {
    // JS 기본
    isNaN, isFinite, parseInt, parseFloat,
    Number, String, Boolean, Array, Object, Function, RegExp, Date, Math, JSON, Error,
    Symbol, Map, Set, WeakMap, WeakSet, Promise,
    encodeURIComponent, decodeURIComponent, encodeURI, decodeURI,
    undefined, NaN, Infinity, console,
    // 브라우저 전역
    document: docStub,
    location: { href: '', search: '', hash: '', pathname: '/', reload: noop, replace: noop },
    history: { pushState: noop, replaceState: noop, back: noop },
    navigator: { userAgent: '', language: 'ko', cookieEnabled: true },
    screen: { width: 1920, height: 1080 },
    alert: noop, confirm: () => false, prompt: () => null,
    setTimeout: noop, setInterval: noop, clearTimeout: noop, clearInterval: noop,
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
    XMLHttpRequest: function() { return { open: noop, send: noop, setRequestHeader: noop }; },
    $, jQuery: $,
  };

  // window = sandbox 자신
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;

  return sandbox;
}

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

    // 모든 script 태그 추출 (멀티라인 포함)
    let script = '';
    const allScriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = allScriptRegex.exec(this._pageSource))) script += match[1] + '\n';

    const functioName = script.match(/function 자료[^\(]*/gm)[0].replace(/\+s/, '').replace('function', '').trim();
    const classCount = resultJson['학급수'];
    const timetableData = {};

    for (let grade = 1; grade <= this._option['maxGrade']; grade++) {
      timetableData[grade] = {};
      for (let classNum = 1; classNum <= classCount[grade]; classNum++) {
        timetableData[grade][classNum] = this._getClassTimetable(
          { data: jsonString, script, functioName }, grade, classNum
        );
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
    const sandbox = makeSandbox();
    const ctx = vm.createContext(sandbox);

    // 페이지 스크립트 실행 (전역 변수/함수 정의)
    try {
      vm.runInContext(codeConfig.script, ctx, { timeout: 5000 });
    } catch (e) {
      // 스크립트 일부 오류는 무시 (브라우저 전용 코드)
    }

    // 시간표 함수 호출
    const call = `${codeConfig.functioName}(${JSON.stringify(codeConfig.data)}, ${grade}, ${classNumber})`;
    const res = vm.runInContext(call, ctx, { timeout: 5000 });

    const _ch = cheerio.load(res);
    const $this = this;
    const timetable = [];

    _ch('tr').each(function (timeIdx) {
      const currentTime = timeIdx - 2;
      if (timeIdx <= 1) return;
      _ch(this).find('td').each(function (weekDayIdx) {
        const currentWeekDay = weekDayIdx - 1;
        if (weekDayIdx === 0 || weekDayIdx === 6) return;
        if (!timetable[currentWeekDay]) timetable[currentWeekDay] = [];
        const subject = _ch(this).contents().first().text();
        const teacher = _ch(this).contents().last().text();
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
