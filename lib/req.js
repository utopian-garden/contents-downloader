'use strict';

// 依存パッケージ
const fs = require('fs-extra');
const axios = require('axios');

require('console-stamp-color')(console, {
  format: ':date(yyyy/mm/dd HH:MM:ss.l) :label'
});

// 設定ファイル
const appConfig = require('../config/app-config.json');

// 定義
const auth = appConfig.req.auth;
const reqPoll = appConfig.req.poll;
const search = appConfig.req.search;
const tag = appConfig.req.tag;

const userAgent = appConfig.req.common.userAgent;

// AuthToken の取得
exports.getToken = async () => {
  const authOptions = {
    method: 'POST',
    url: auth.authUrl,
    headers: {
      'User-Agent': userAgent
    },
    json: true,
    data: {
      login: auth.userName,
      password: auth.passWord
    },
    timeout: reqPoll.middlePoll * 1000
  };

  try {
    return auth.authPrefix + (await axios.request(authOptions)).data.access_token;
  } catch(err) {
    throw err;
  }
}

// ポストの検索
exports.searchPost = async (tagKey, pageNum, searchParam, authToken) => {
  const searchUrl = search.searchUrl + encodeURIComponent(tagKey) + searchParam
      + pageNum;
  const searchOptions = {
    method: 'GET',
    url: searchUrl,
    headers: {
      'User-Agent': userAgent,
      'Authorization': authToken
    },
    timeout: reqPoll.middlePoll * 1000
  };

  try {
    return (await axios.request(searchOptions)).data;
  } catch(err) {
    throw err;
  }
}

// タグの検索
exports.searchTag = async (tagCode, pageNum, authToken) => {
  const searchUrl = search.tagSearchUrl + tagCode + search.tagSearchParam
      + pageNum;
  const searchOptions = {
    method: 'GET',
    url: searchUrl,
    headers: {
      'User-Agent': userAgent,
      'Authorization': authToken
    },
    timeout: reqPoll.middlePoll * 1000
  };

  try {
    return (await axios.request(searchOptions)).data;
  } catch(err) {
    throw err;
  }
}

// ポストのコンテンツダウンロード
exports.dlContent = async (filePath, fileUrl, refererUrl) => {
  const dlOptions = {
    method: 'GET',
    url: fileUrl,
    encoding: null,
    headers: {
      'User-Agent': userAgent,
      'Referer': refererUrl
    },
    responseType: 'arraybuffer'
  };

  try {
    const dlRes = await axios.request(dlOptions);
    fs.outputFileSync(filePath, dlRes.data);
  } catch(err) {
    throw err;
  }
}

// ポストのタグ追加
exports.tagPut = async (postId, reqJson, authToken) => {
  const tagUrl = tag.tagUrl + postId + tag.tagParam;
  const tagOptions = {
    method: 'PUT',
    url: tagUrl,
    headers: {
      'User-Agent': userAgent,
      'Authorization': authToken
    },
    json: true,
    data: reqJson,
    timeout: reqPoll.middlePoll * 1000
  };

  try {
    const result = (await axios.request(tagOptions)).data;
    console.info(JSON.stringify({"success": result.success}));
  } catch(err) {
    throw err;
  }
}
