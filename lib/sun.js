'use strict';
// Sunset times for Sabbath reminders, calculated offline from the church's latitude/longitude
// (standard "sunrise equation", accurate to a minute or two away from the polar regions).
const RAD = Math.PI / 180;
const J1970 = 2440587.5;
const J2000 = 2451545.0;
const DAY_MS = 86400000;

const toJulian = (ms) => ms / DAY_MS + J1970;
const fromJulian = (j) => (j - J1970) * DAY_MS;

// Sunset (ms since epoch) for the calendar day that contains `date` (local time), or null.
function sunset(date, lat, lng) {
  const noon = new Date(date);
  noon.setHours(12, 0, 0, 0);
  const n = Math.round(toJulian(noon.getTime()) - J2000 - 0.0009 + lng / 360);
  const jStar = n + 0.0009 - lng / 360;
  const M = ((357.5291 + 0.98560028 * jStar) % 360) * RAD;
  const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
  const lambda = (M + C + Math.PI + 102.9372 * RAD) % (2 * Math.PI);
  const transit = J2000 + jStar + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * lambda);
  const dec = Math.asin(Math.sin(lambda) * Math.sin(23.4397 * RAD));
  const phi = lat * RAD;
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW < -1 || cosW > 1) return null; // midnight sun / polar night
  return Math.round(fromJulian(transit + Math.acos(cosW) / (2 * Math.PI)));
}

// Always a 12-hour clock ("6:42 pm"), whatever the PC's regional time format is.
const fmtTime = (ms) => {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
const fmtDay = (ms) => new Date(ms).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

// Everything the screens and the control panel need, as ready-to-show text.
function sabbathInfo(lat, lng, now = new Date()) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const today = new Date(now);
  const dow = today.getDay(); // 0 Sun … 5 Fri, 6 Sat
  const sunsetToday = sunset(today, lat, lng);
  // This (or the coming) Sabbath: Friday sunset → Saturday sunset.
  let friday = addDays(today, (5 - dow + 7) % 7);
  if (dow === 6) friday = addDays(today, -1);
  const fri = sunset(friday, lat, lng);
  const sat = sunset(addDays(friday, 1), lat, lng);
  // After Saturday sunset, "this Sabbath" is next week's.
  let begins = fri;
  let ends = sat;
  let fridayDate = friday;
  if (sat && now.getTime() > sat) {
    fridayDate = addDays(friday, 7);
    begins = sunset(fridayDate, lat, lng);
    ends = sunset(addDays(fridayDate, 1), lat, lng);
  }
  const nextFri = sunset(addDays(fridayDate, 7), lat, lng);
  const isSabbath = !!(begins && ends && now.getTime() >= begins && now.getTime() < ends);
  const sameDay = (ms) => ms && new Date(ms).toDateString() === today.toDateString();
  const whenText = (ms) => (!ms ? '' : sameDay(ms) ? fmtTime(ms) : `${fmtDay(ms)} at ${fmtTime(ms)}`);
  let label = sunsetToday ? `Sunset ${fmtTime(sunsetToday)}` : '';
  if (isSabbath) label = `Sabbath ends ${fmtTime(ends)}`;
  else if (sameDay(begins)) label = `Sabbath begins ${fmtTime(begins)}`;
  return {
    label,
    isSabbath,
    tokens: {
      sunset: sunsetToday ? fmtTime(sunsetToday) : '',
      'sabbath-begins': whenText(begins),
      'sabbath-ends': whenText(ends),
      'next-sabbath-begins': whenText(nextFri),
    },
    times: { sunsetToday, begins, ends, nextFri },
  };
}

// Replace {sunset}, {sabbath-begins}, {sabbath-ends} and {next-sabbath-begins} in text.
function fillTokens(text, info) {
  return String(text || '').replace(/\{(sunset|sabbath-begins|sabbath-ends|next-sabbath-begins)\}/g, (m, k) =>
    (info && info.tokens[k]) || '[set your location in Settings → General]');
}

module.exports = { sunset, sabbathInfo, fillTokens };
