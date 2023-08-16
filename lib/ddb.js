'use strict';

// 依存パッケージ
const AWS = require('aws-sdk');

// 設定ファイル
AWS.config.loadFromPath('./config/aws-config.json');

// オブジェクト化
const docClient = new AWS.DynamoDB.DocumentClient();

// DBスキャン
exports.scanAll = async (reqTable) => {
  // DynamoDB のスキャン制限に対応するために、最後のキーになるまでスキャンを繰り返す
  const scanParams = {
    TableName: reqTable,
  };
  const resItems = [];
  const scan = async () => {
    const result = await docClient.scan(scanParams).promise();
    resItems.push(...result.Items);

    // 結果が途中である限り最終行を開始行に代入して繰り返し実行
    if (result.LastEvaluatedKey) {
      scanParams.ExclusiveStartKey = result.LastEvaluatedKey;
      await scan();
    }
  }

  try {
    await scan();
    return resItems;
  } catch (err) {
    throw err;
  };
}

// DB アイテム取得
exports.getItem = async (reqTable, reqTag) => {
  const getParams = {
    TableName: reqTable,
    Key: {
      'tag': reqTag
    }
  };

  try {
    const dbItems = await docClient.get(getParams).promise();
    return dbItems;
  } catch (err) {
    throw err;
  }
};

// DB 追加
exports.addItem = async (reqTable, reqTag) => {
  const updParams = {
    TableName: reqTable,
    Key: {
      'tag': reqTag
    }
  };

  try {
    await docClient.update(updParams).promise();
  } catch (err) {
    throw err;
  }
}

// DB 更新
exports.updateItem = async (reqTable, reqKey, reqAttr, reqValue) => {
  const updParams = {
    TableName: reqTable,
    Key: {
      'tag': reqKey
    },
    ExpressionAttributeNames: {
      '#l': reqAttr
    },
    ExpressionAttributeValues: {
      ':newLast': reqValue
    },
    UpdateExpression: 'SET #l = :newLast'
  };

  try {
    await docClient.update(updParams).promise();
  } catch (err) {
    throw err;
  }
}

// DB 配列更新
exports.addArrayItem = async (reqTable, reqKey, reqAttr, reqValue) => {
  const putParams = {
    TableName: reqTable,
    Item: {
      'tag': reqKey,
      [reqAttr]: [reqValue]
    },
    ConditionExpression: 'attribute_not_exists(tag)'
  };

  const updParams = {
    TableName: reqTable,
    Key: {
      'tag': reqKey
    },
    ExpressionAttributeNames: {
      '#l': reqAttr
    },
    ExpressionAttributeValues: {
      ':post': reqValue,
      ':empty_list': []
    },
    UpdateExpression: 'SET #l = list_append(if_not_exists(#l, :empty_list), :post)',
    ConditionExpression: 'attribute_exists(tag)' // 必要に応じて追加
  };

  try {
    await docClient.put(putParams).promise();
  } catch (err) {
    // アイテムが既に存在する場合は更新を試みる
    if (err.code === 'ConditionalCheckFailedException') {
      try {
        await docClient.update(updParams).promise();
      } catch (err) {
        throw err;
      }
    } else {
      throw err;
    }
  }
}

// DB 削除
exports.deleteItem = async (reqTable, reqTag) => {
  const delParams = {
    TableName: reqTable,
    Key: {
      'tag': reqTag
    }
  };

  try {
    await docClient.delete(delParams).promise();
  } catch (err) {
    throw err;
  }
}

// DB 一括処理
exports.writeItems = async (reqTable, reqTags) => {
  const writeParams = {
    RequestItems: {
      [reqTable]: reqTags
    }
  };

  try {
    await docClient.batchWrite(writeParams).promise();
  } catch (err) {
    throw err;
  }
}
