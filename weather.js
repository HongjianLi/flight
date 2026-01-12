#!/usr/bin/env node
import fs from 'fs/promises';
import puppeteer from 'puppeteer-core';
import ProgressBar from 'progress';
const [ forecastArr, city2code/*, code2city*/ ] = await Promise.all(['../map/weather/weather/city/forecast.json', 'airportsCityCode.json'/*, 'airportsCodeCity.json'*/].map(p => fs.readFile(p).then(JSON.parse))); // Prefer weather to nmc because weather provides the sky key 晴天预报, which indicates whether 灰霾 occurs.
const browser = await puppeteer.launch({
	defaultViewport: { width: 1280, height: 2160 }, // Increase the deviceScaleFactor will increase the resolution of screenshots.
	executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
//	headless: false,
});
const page = (await browser.pages())[0];
await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
await page.setExtraHTTPHeaders({
	'accept-language': 'en,en-US;q=0.9,zh-CN;q=0.8,zh-TW;q=0.7,zh;q=0.6',
	'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
	'sec-ch-ua-mobile': '?0',
	'sec-ch-ua-platform': '"Linux"',
});
const srcCityArr = ['广州', '深圳'];
const flightCache = {}; // This is a cache for the flight results, to avoid unnecessary page requests, e.g. "扬州": ["YTY"] and "泰州": ["YTY"], the flight results for 扬州 can be re-used for 泰州.
const bar = new ProgressBar('[:bar] :city :current/:total=:percent :elapseds :etas', { total: forecastArr.length });
for (const fc of forecastArr) {
	const { city: dstCity, forecast } = fc; // fc.city is dstCity.
	bar.tick({ city: dstCity });
	if (bar.curr <= 23) continue; // curr starts from one. The first 23 cities are 香港, 澳门 and 广东21市. 无须飞机航班，乘坐高铁即可。
	const dstCodeArr = city2code[dstCity];
	if (!dstCodeArr) continue; // Skip cities without airports.
	const dstCode = dstCodeArr[0]; // It's sufficient to get just the first code for the city, e.g. CTU for 成都, because ly.com will return the flights for all airports of the same city, e.g. including TFU.
	for (let i = 1; i < 5; ++i) {
		const f = forecast[i];
		if (f.uncomfortable) continue;
		const n = Math.min(6 - i, 4); // The number of days ahead to check.
		if ([...Array(n).keys()].reduce((acc, cur) => { // In the following n days, the number of uncomfortable days must be less than half.
			return acc + forecast[i + 1 + cur].uncomfortable;
		}, 0) >= n / 2) continue;
		const cache = flightCache[`${f.date}${dstCode}`]; // If this specific date and dstCode has been searched before, use the cache.
		if (cache) {
			f.flight = cache;
			continue;
		}
		for (const srcCity of srcCityArr) {
			const srcCode = city2code[srcCity][0];
			let response;
			try {
				response = await page.goto(`https://www.ly.com/flights/itinerary/oneway/${srcCode}-${dstCode}?date=${f.date}`, { waitUntil: 'networkidle0' });
			} catch (error) { // In case of error, e.g. TimeoutError, continue to goto the next srcCity.
				console.error(`${f.date} ${srcCity}-${dstCity}: page.goto() error ${error}`);
				continue;
			}
			if (response.ok()) {
				const noFlights = await page.$('div.flight-no-data');
				if (noFlights !== null) { await noFlights.dispose(); continue }; // If no flights from src to dst, skip it.
				for (let prevHeight = 0; true;) {
					await page.evaluate(() => {
						window.scrollTo(0, document.body.scrollHeight);
					});
					await new Promise(resolve => setTimeout(resolve, 2120)); // Wait for some seconds for new contents to load.
//					await page.waitForNetworkIdle({ idleTime: 2000 }); // Time (in milliseconds) the network should be idle.
					const newHeight = await page.evaluate(() => document.body.scrollHeight);
					if (newHeight === prevHeight) break; // Break the loop if no new content was loaded.
					prevHeight = newHeight;
				}
				const flightList = await page.$$('div.flight-lists-container>div.flight-item');
				for (const flight of flightList) {
					const price = parseInt((await flight.$eval('div.head-prices>strong>em', el => el.innerText)).slice(1)); // .slice(1) to filter out the currency symbol ￥.
					const srcTime = await flight.$eval('div.f-startTime>strong', el => el.innerText); // e.g. 14:25
					const srcHour = parseInt(srcTime.slice(0, 2)); // e.g. 14
					if (srcHour < 10 || srcHour > 16) continue; // srcHour: [10, 16] is acceptable, equivalent to srcTime: [10:00, 16:59].
					const duration = await flight.$eval('div.f-line-to>i', el => el.innerText); // e.g. 3h0m
					const durHour = parseInt(duration.split('h')[0]);
					if (durHour > 6) continue; // durHour: [1, 6] is acceptable, equivalent to duration: [1h0m, 6h59m].
					const transition = await flight.$('div.f-line-to>div.v-popover'); // e.g. 经停, 华夏联程
					if (transition !== null) { await transition.dispose(); continue }; // If the current flight has a transition, skip it.
//					console.log(`${f.date} ${srcTime} ${duration} ${srcCity}-${dstCity} ￥${price}`);
					if (!f.flight || f.flight.price > price) {
						const no = await flight.$eval('p.flight-item-name', el => el.innerText); // e.g. 东方航空MU5742
						const carrier = await flight.$eval('span.flight-item-type', el => el.innerText); // e.g. 波音737(中)
						const dstTime = await flight.$eval('div.f-endTime>strong', el => el.innerText); // e.g. 17:25
						const srcPort = await flight.$eval('div.f-startTime>em', el => el.innerText); // e.g. 白云机场T1
						const dstPort = await flight.$eval('div.f-endTime>em', el => el.innerText); // e.g. 三义机场
						flightCache[`${f.date}${dstCode}`] = f.flight = {
							no, carrier, duration, price,
							src: { time : srcTime, airport: srcPort, city: srcCity }, // code: srcCode is not necessarily correct, because when searching e.g. src: CTU, ly.com will also return flights departing from TFU.
							dst: { time : dstTime, airport: dstPort }, // code: dstCode is not necessarily correct either. Same reason, when searching dst: CTU, ly.com will also return flights arriving at TFU.
						};
					}
					break; // The flightList is sorted by price ascendingly, so skip processing if the current flight is already satisfactory.
				}
				for (const flight of flightList) {
					await flight.dispose();
				}
			} else {
				console.error(`${f.date} ${srcCity}-${dstCity}: HTTP response status code ${response.status()}`);
			}
		}
	}
}
await browser.close();
await fs.writeFile('../map/weather/weather/city/forecast.json', JSON.stringify(forecastArr, null, '	'));
