import consoleStamp from 'console-stamp-color';
import { discovery, buildAuthorizationUrl } from 'openid-client';
import puppeteer from 'puppeteer';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const { server_url, client_id, redirect_uri, state } = appConfig.auth.oidc;
const { email, password } = appConfig.auth.credentials;
const { exts } = appConfig.auth.truncate;

const getTokens = async () => {
  // OIDC 設定
  const server = new URL(server_url);
  const config = await discovery(server, client_id);

  const parameters = {
    scope: 'openid',
    route: 'login',
    theme: 'white',
    lang: 'ja',
    redirect_uri: redirect_uri,
    state: state
  };

  const redirectTo = buildAuthorizationUrl(config, parameters);

  // ログイン
  const browser = await puppeteer.launch({
    headless: false
  });

  const [page] = await browser.pages();

  page.setDefaultNavigationTimeout(180000);
  page.setDefaultTimeout(180000);
  page.setRequestInterception(true);

  page.on('request', (request) => {
    const url = new URL(request.url().toLowerCase());
    if (exts.some(ext => url.pathname.endsWith(ext))) {
      request.abort();
    } else {
      request.continue();
    }
  });

  await page.goto(redirectTo);

  await page.type('input[name="email"]', email);
  await page.type('input[name="password"]', password);

  await Promise.all([
    page.waitForSelector('img[alt="' + email + '"]'),
    page.click('button[data-test="login"]')
  ]);

  // トークンの取得
  const cookies = await browser.cookies();
  const accessToken = cookies.find(c => c.name === 'accessToken')?.value;
  const refreshToken = cookies.find(c => c.name === 'refreshToken')?.value;

  await browser.close();

  return { accessToken: accessToken, refreshToken: refreshToken };
};

export { getTokens };
