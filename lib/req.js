// 依存パッケージ
import axios from 'axios';
import consoleStamp from 'console-stamp-color';
import fs from 'fs-extra';
import got from 'got';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// 設定ファイル
import appConfig from '../config/app-config.json' with { type: 'json' };

// 定義
const auth = appConfig.req.auth;
const header = appConfig.req.header;
const reqPoll = appConfig.req.poll;
const search = appConfig.req.search;
const tag = appConfig.req.tag;

// AuthToken の取得
const getToken = async () => {
  const authOptions = {
    method: 'POST',
    url: auth.authUrl,
    headers: {
      'User-Agent': header.userAgent
    },
    json: true,
    data: {
      login: auth.userName,
      password: auth.passWord
    },
    timeout: reqPoll.middlePoll * 1000
  };

  return auth.authPrefix + (await axios.request(authOptions)).data.access_token;
};

// ポストの検索
const searchPost = async (tagKey, pageNum, next, authToken) => {
  let searchUrl = search.searchUrl + encodeURIComponent(tagKey) + search.searchParam + pageNum;
  if (next) {
    searchUrl += search.searchParamNext + next;
  }
  const searchOptions = {
    method: 'GET',
    url: searchUrl,
    headers: {
      'User-Agent': header.userAgent,
      'Authorization': authToken,
      'Referer': search.refererUrl
    },
    timeout: reqPoll.middlePoll * 1000
  };

  return (await axios.request(searchOptions)).data;
};

// タグの検索
const searchTag = async (tagCode, pageNum, authToken) => {
  const searchUrl = search.tagSearchUrl + tagCode + search.tagSearchParam + pageNum;
  const searchOptions = {
    method: 'GET',
    url: searchUrl,
    headers: {
      'User-Agent': header.userAgent,
      'Authorization': authToken
    },
    timeout: reqPoll.middlePoll * 1000
  };

  return (await axios.request(searchOptions)).data;
};

// ポストのコンテンツダウンロード
const dlContent = async (filePath, fileUrl, refererUrl) => {
  let fileSize = 0;

  if (fs.existsSync(filePath)) {
    fileSize = fs.statSync(filePath).size;
  }

  const headers = {
    'User-Agent': header.userAgent,
    'Referer': refererUrl,
    'Range': `bytes=${fileSize}-`,
  };

  const writer = fs.createWriteStream(filePath, { flags: 'a' });

  const downloadStream = got.stream(fileUrl, { headers });

  downloadStream.pipe(writer);

  return new Promise((resolve, reject) => {
    downloadStream.on('end', resolve);
    downloadStream.on('error', reject);
    writer.on('error', reject);
  });
};

// ポストのタグ追加
const tagPut = async (postId, reqJson, authToken) => {
  const tagUrl = tag.tagUrl + postId + tag.tagParam;
  const tagOptions = {
    method: 'PUT',
    url: tagUrl,
    headers: {
      'User-Agent': header.userAgent,
      'Authorization': authToken
    },
    json: true,
    data: reqJson,
    timeout: reqPoll.middlePoll * 1000
  };

  const result = (await axios.request(tagOptions)).data;
  console.info(JSON.stringify({ 'success': result.success }));
};

// レートの検索
const searchRate = async (postId, authToken) => {
  const searchUrl = search.rateSearchUrl + postId;
  const searchOptions = {
    method: 'GET',
    url: searchUrl,
    headers: {
      'User-Agent': header.userAgent,
      'Authorization': authToken
    },
    timeout: reqPoll.middlePoll * 1000
  };

  return (await axios.request(searchOptions)).data;
};

const req = {
  getToken,
  searchPost,
  searchTag,
  dlContent,
  tagPut,
  searchRate
};
export default req;
