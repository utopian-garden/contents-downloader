window.addEventListener('load', () => {
  // リンクの検索オプションを追加
  document.querySelectorAll(
    '[class*="tag-type-"] > a'
  ).forEach(link => {
    link.setAttribute('href', link.getAttribute('href') + '+order:quality+-rating:safe');
  });

  // 検索ボックスのオプションを追加
  let box = document.getElementById('tags');
  if (box) {
    if (!box.value.includes('order')) {
      box.value += ' order:quality';
    }

    if (!box.value.includes('rating')) {
      box.value += ' -rating:safe';
    }
  }

  // 動画のデフォルト設定の制御
  let video = document.getElementById('image');
  if (video) {
    if (video.tagName === 'video') {
      video.loop = false;
    }
  }

  // 次ページへのリンク表示
  document.querySelectorAll('[class="disabled"]').forEach(link => {
    const currentUrl = location.href;
    const pageNum = Number(currentUrl.split('=').pop());
    const nextLink = document.createElement('a');
    nextLink.href = currentUrl.replace(String(pageNum), String(pageNum + 1));
    nextLink.textContent = '>>';
    link.textContent = '';
    link.appendChild(nextLink);
  });

  // 次ページへのリンクを常に表示
  var stickyElement = document.getElementById('sticky');
  if (stickyElement && stickyElement !== undefined) {
    stickyElement.classList.add('stick');
  }

  // 画像詳細検索へのリンクに書き換え
  const postContent = document.getElementById('post-content');
  const nodeInfo = document.getElementById('node-info');
  const imageLink = document.getElementById('image');

  if (imageLink && imageLink !== undefined) {
    const detailDiv = document.createElement('div');
    const detailLink = document.createElement('a');
    detailLink.href = 'https://ascii2d.net/search/url/' + encodeURIComponent(imageLink.src);
    detailLink.textContent = 'Detail';
    detailDiv.appendChild(detailLink);
    postContent.insertBefore(detailDiv, nodeInfo);
  }
});

// リンクを取得して開く or 文字列をバックグラウンドへ送信
chrome.runtime.onMessage.addListener(msg => {
  switch (msg.type) {
    // リンクを取得して開く
    case 'open':
      document.querySelectorAll('[class*="preview"]:not([id*="comment-preview-"])').forEach(link => {
        window.open(link.parentNode.href);
      });

      break;

    // Download に追加
    case 'download':
      document.querySelectorAll('[class*="tag-type-artist"], [class*="tag-type-studio"]').forEach(link => {
        const tagKey = decodeURIComponent(link.firstChild.href.split('=').pop().split('+').shift());
        addRequest(tagKey, 'Download');
      });

      break;

    // Ignore に追加
    case 'ignore':
      document.querySelectorAll('[class*="tag-type-artist"], [class*="tag-type-studio"]').forEach(link => {
        const tagKey = decodeURIComponent(link.firstChild.href.split('=').pop().split('+').shift());
        addRequest(tagKey, 'Ignore');
      });

      break;
  }
});

// リンクを取得してバックグラウンドへ送信
chrome.runtime.onMessage.addListener(msg => {
  switch (msg.type) {
    case 'get':
      document.querySelectorAll('[class*="fa-magnet"]').forEach(link => {
        chrome.runtime.sendMessage({
          type: 'url',
          value: link.parentNode.href
        });
      });

      break;
  }
});

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
