'use strict';

// 依存パッケージ
import {
  BatchWriteItemCommand,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
  UpdateItemCommand
} from '@aws-sdk/client-dynamodb';

// 設定ファイル
import config from '../config/aws-config-ddb.json' assert { type: 'json' };

// オブジェクト化
const client = new DynamoDBClient(config);

// DBスキャン
const scanAll = async (reqTable) => {
  const scanParams = {
    TableName: reqTable,
  };
  const resItems = [];
  let startKey;

  do {
    if (startKey) {
      scanParams.ExclusiveStartKey = startKey;
    }

    const command = new ScanCommand(scanParams);
    const { Items, LastEvaluatedKey } = await client.send(command);
    resItems.push(...Items);
    startKey = LastEvaluatedKey;

  } while (startKey);

  return resItems;
};

// DB アイテム取得
const getItem = async (reqTable, reqKey) => {
  const getParams = {
    TableName: reqTable,
    Key: reqKey
  };
  const command = new GetItemCommand(getParams);
  const { Item } = await client.send(command);
  return Item;
};

// DB 追加
const addItem = async (reqTable, item) => {
  const putParams = {
    TableName: reqTable,
    Item: item
  };
  const command = new PutItemCommand(putParams);
  await client.send(command);
};

// DB 更新
const updateItem = async (reqTable, reqKey, reqAttr, reqValue) => {
  const updateParams = {
    TableName: reqTable,
    Key: reqKey,
    UpdateExpression: `set ${reqAttr} = :val`,
    ExpressionAttributeValues: {
      ':val': reqValue
    },
    ReturnValues: 'UPDATED_NEW'
  };
  const command = new UpdateItemCommand(updateParams);
  await client.send(command);
};

// DB 配列更新
const addArrayItem = async (reqTable, reqKey, reqAttr, reqValue) => {
  const putCommand = new PutItemCommand({
    TableName: reqTable,
    Item: {
      'tag': reqKey,
      [reqAttr]: [reqValue]
    },
    ConditionExpression: 'attribute_not_exists(tag)'
  });

  try {
    await client.send(putCommand);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      const updateCommand = new UpdateItemCommand({
        TableName: reqTable,
        Key: {
          'tag': reqKey
        },
        ExpressionAttributeNames: {
          '#l': reqAttr
        },
        ExpressionAttributeValues: {
          ':post': [reqValue], // DynamoDBのリストへの追加は配列が必要
          ':empty_list': []
        },
        UpdateExpression: 'SET #l = list_append(if_not_exists(#l, :empty_list), :post)',
        ConditionExpression: 'attribute_exists(tag)'
      });
      await client.send(updateCommand);
    } else {
      throw err;
    }
  }
};

// DB 削除
const deleteItem = async (reqTable, reqTag) => {
  const deleteCommand = new DeleteItemCommand({
    TableName: reqTable,
    Key: {
      'tag': reqTag
    }
  });

  await client.send(deleteCommand);
};

// DB 一括処理
const writeItems = async (reqTable, reqItems) => {
  const writeCommand = new BatchWriteItemCommand({
    RequestItems: {
      [reqTable]: reqItems.map(tag => ({
        PutRequest: {
          Item: tag
        }
      }))
    }
  });

  await client.send(writeCommand);
};

const ddb = { scanAll, getItem, addItem, updateItem, addArrayItem, deleteItem, writeItems };
export default ddb;
