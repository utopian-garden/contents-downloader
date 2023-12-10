// addItem リクエストの発行
const addRequest = (tagKey, addTab) => {
  fetch('http://localhost:3000/addItem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      'table': addTab,
      'tag': tagKey
    }),
  });
};

// コンテキストメニューの Download をクリックした場合
chrome.contextMenus.create({
  id: 'link-download',
  title: 'Download',
  contexts: ['link'],
  documentUrlPatterns: ['*://chan.sankakucomplex.com/*']
});

// コンテキストメニューの Download をクリックした場合
chrome.contextMenus.create({
  id: 'page-download',
  title: 'Download',
  contexts: ['page'],
  documentUrlPatterns: ['*://chan.sankakucomplex.com/*']
});

// コンテキストメニューの Open をクリックした場合
chrome.contextMenus.create({
  id: 'page-open-link',
  title: 'Open links',
  contexts: ['page'],
  documentUrlPatterns: ['*://*.nyaa.si/*']
});

// コンテキストメニューの Get をクリックした場合
chrome.contextMenus.create({
  id: 'page-get-link',
  title: 'Get links',
  contexts: ['page'],
  documentUrlPatterns: ['*://*.nyaa.si/*']
});

// コンテンツからメッセージを受信した場合
chrome.runtime.onMessage.addListener(msg => {
  const url = msg.value;

  switch (msg.type) {
    case 'url':
      fetch('http://localhost:3000/getLink', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          'url': url
        }),
      });

      break;
  }
});

function contextClick(info) {
  const { menuItemId } = info;
  let tagKey;

  switch (menuItemId) {
    case 'link-download':
      tagKey = decodeURIComponent(info.linkUrl.split('=').pop().split('+').shift());
      addRequest(tagKey, 'Download');

      break;
    case 'page-download':
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        chrome.tabs.sendMessage(tabs[0].id, { 'type': 'download' });
      });

      break;
    case 'page-open-link':
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        chrome.tabs.sendMessage(tabs[0].id, { 'type': 'open' });
      });

      break;
    case 'page-get-link':
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        chrome.tabs.sendMessage(tabs[0].id, { 'type': 'get' });
      });

      break;
  }
}

chrome.contextMenus.onClicked.addListener(contextClick);
