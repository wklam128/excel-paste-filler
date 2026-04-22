const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const browser = await puppeteer.launch({args:['--no-sandbox']});
  const page = await browser.newPage();
  await page.setViewport({width:1280,height:800,deviceScaleFactor:1});
  const files = ['ss1_paste_fill','ss2_translate_tooltip','ss3_multirow','ss4_popup','ss5_options'];
  for(const f of files){
    const fp = 'file:///' + path.resolve(f+'.html').replace(/\\/g, '/');
    await page.goto(fp,{waitUntil:'networkidle0'});
    await page.screenshot({path:f+'.png',clip:{x:0,y:0,width:1280,height:800}});
    console.log('done',f);
  }
  await browser.close();
})();
