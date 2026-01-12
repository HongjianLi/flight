#!/usr/bin/env node
import fs from 'fs/promises';
import puppeteer from 'puppeteer-core';
const now = new Date();
const dateStr = now.toLocaleDateString('en-CA'); // This locale outputs date as yyyy-mm-dd
const timeStr = now.toLocaleTimeString('zh-CN'); // This locale outputs time as HH:MM:SS
const [ dsdArr, city2code ] = await Promise.all(['index.json', 'airportsCityCode.json'].map(p => fs.readFile(p).then(JSON.parse)));
const browser = await puppeteer.launch({
	defaultViewport: { width: 1280, height: 2160 },
	executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
});
const page = (await browser.pages())[0];
await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
await page.setExtraHTTPHeaders({
	'accept-language': 'en,en-US;q=0.9,zh-CN;q=0.8,zh-TW;q=0.7,zh;q=0.6',
	'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
	'sec-ch-ua-mobile': '?0',
	'sec-ch-ua-platform': '"Linux"',
});
for (const dsd of dsdArr) {
	const { date, srcCity, dstCity } = dsd;
	if (date < dateStr) continue; // Skip crawling if the intended travel date has been passed.
	const srcCode = city2code[srcCity][0];
	const dstCode = city2code[dstCity][0];
	const response = await page.goto(`https://www.ly.com/flights/itinerary/oneway/${srcCode}-${dstCode}?date=${date}`, { waitUntil: 'networkidle0' });
	console.assert(response.ok());
	const noFlights = await page.$('div.flight-no-data');
	console.assert(noFlights === null);
	for (let prevHeight = 0; true;) {
		await page.evaluate(() => {
			window.scrollTo(0, document.body.scrollHeight);
		});
		await new Promise(resolve => setTimeout(resolve, 2120)); // Wait for some seconds for new contents to load.
//		await page.waitForNetworkIdle({ idleTime: 2000 }); // Time (in milliseconds) the network should be idle.
		const newHeight = await page.evaluate(() => document.body.scrollHeight);
		if (newHeight === prevHeight) break; // Break the loop if no new content was loaded.
		prevHeight = newHeight;
	}
	const flightList = await page.$$('div.flight-lists-container>div.flight-item');
	const flightArr = await Promise.all(flightList.map(async flight => {
		const transition = await flight.$('div.f-line-to>div.v-popover'); // e.g. 经停, 华夏联程
		if (transition !== null) { await transition.dispose(); await flight.dispose(); return; }; // If the current flight has a transition, skip it.
		const price = parseInt((await flight.$eval('div.head-prices>strong>em', el => el.innerText)).slice(1)); // .slice(1) to filter out the currency symbol ￥.
		const discount = (await flight.$eval('div.head-prices>i', el => el.innerText)); // e.g. 特惠经济舱, 3.7折经济舱
		const srcTime = await flight.$eval('div.f-startTime>strong', el => el.innerText); // e.g. 14:25
		const dstTime = await flight.$eval('div.f-endTime>strong', el => el.innerText); // e.g. 17:25
		const duration = await flight.$eval('div.f-line-to>i', el => el.innerText); // e.g. 3h0m
		const durHour = parseInt(duration.split('h')[0]);
		console.assert(durHour <= 6); // durHour: [1, 6] is acceptable, equivalent to duration: [1h0m, 6h59m].
		const no = await flight.$eval('p.flight-item-name', el => el.innerText); // e.g. 东方航空MU5742
		const carrier = await flight.$eval('span.flight-item-type', el => el.innerText); // e.g. 波音737(中)
		const srcPort = await flight.$eval('div.f-startTime>em', el => el.innerText); // e.g. 白云机场T1
		const dstPort = await flight.$eval('div.f-endTime>em', el => el.innerText); // e.g. 三义机场
		await flight.dispose();
		return `${[ dateStr, timeStr, no, carrier, srcTime, srcPort, duration, dstTime, dstPort, price, discount ].join('	')}\n`;
	}));
	await fs.appendFile(`${date}-${srcCity}-${dstCity}.tsv`, flightArr.join(''));
}
await browser.close();
