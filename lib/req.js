// 依存パッケージ
import axios from 'axios';
import consoleStamp from 'console-stamp-color';
import fs from 'fs-extra';

consoleStamp(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// 設定ファイル
import appConfig from '../config/app-config.json' assert { type: 'json' };

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
const searchPost = async (tagKey, pageNum, searchParam, authToken) => {
  const searchUrl = search.searchUrl + encodeURIComponent(tagKey) + searchParam
    + pageNum;
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

// タグの検索
const searchTag = async (tagCode, pageNum, authToken) => {
  const searchUrl = search.tagSearchUrl + tagCode + search.tagSearchParam
    + pageNum;
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
  const dlOptions = {
    method: 'GET',
    url: fileUrl,
    encoding: null,
    headers: {
      'User-Agent': header.userAgent,
      'Referer': refererUrl
    },
    responseType: 'arraybuffer'
  };

  const dlRes = await axios.request(dlOptions);
  fs.outputFileSync(filePath, dlRes.data);
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

const req = {
  getToken,
  searchPost,
  searchTag,
  dlContent,
  tagPut
};
export default req;
