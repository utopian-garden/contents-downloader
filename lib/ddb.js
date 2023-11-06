'use strict';

// 依存パッケージ
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand
} from '@aws-sdk/lib-dynamodb';

// 設定ファイル
import ddbConfig from '../config/aws-config-ddb.json' assert { type: 'json' };

// AWS SDK v3のDynamoDBクライアントの設定
const client = new DynamoDBClient(ddbConfig);

const translateConfig = {
  marshallOptions: {
    convertEmptyValues: false,
    removeUndefinedValues: false,
    convertClassInstanceToMap: false,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
};

// DynamoDB DocumentClientの初期化
const ddbDocClient = DynamoDBDocumentClient.from(client, translateConfig);

// DBスキャン
const scanAll = async (reqTable) => {
  const scanParams = {
    TableName: reqTable,
  };
  const resItems = [];
  const scan = async () => {
    const scanCommand = new ScanCommand(scanParams);
    const result = await ddbDocClient.send(scanCommand);
    resItems.push(...result.Items);

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
const getItem = async (reqTable, reqTag) => {
  const getParams = {
    TableName: reqTable,
    Key: {
      'tag': reqTag
    }
  };

  try {
    const getCommand = new GetCommand(getParams);
    const dbItems = await ddbDocClient.send(getCommand);
    return dbItems;
  } catch (err) {
    throw err;
  }
};

// DB 追加
const addItem = async (reqTable, reqTag) => {
  const updParams = {
    TableName: reqTable,
    Key: {
      'tag': reqTag
    }
  };

  try {
    const updCommand = new UpdateCommand(updParams);
    await ddbDocClient.send(updCommand);
  } catch (err) {
    throw err;
  }
}

// DB 更新
const updateItem = async (reqTable, reqKey, reqAttr, reqValue) => {
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
    const updCommand = new UpdateCommand(updParams);
    await ddbDocClient.send(updCommand);
  } catch (err) {
    throw err;
  }
}

// DB 配列更新
const addArrayItem = async (reqTable, reqKey, reqAttr, reqValue) => {
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
    ConditionExpression: 'attribute_exists(tag)'
  };

  try {
    const putCommand = new PutCommand(putParams);
    await ddbDocClient.send(putCommand);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      try {
        const updCommand = new UpdateCommand(updParams);
        await ddbDocClient.send(updCommand);
      } catch (updateError) {
        console.error('Error occurred during update:', updateError);
        throw updateError;
      }
    } else {
      console.error('Error occurred during put:', err);
      throw err;
    }
  }
}

// DB 削除
const deleteItem = async (reqTable, reqTag) => {
  const delParams = {
    TableName: reqTable,
    Key: {
      'tag': reqTag
    }
  };

  try {
    const delCommand = new DeleteCommand(delParams);
    await ddbDocClient.send(delCommand);
  } catch (err) {
    throw err;
  }
}

// DB 一括処理
const writeItems = async (reqTable, reqTags) => {
  const writeParams = {
    RequestItems: {
      [reqTable]: reqTags
    }
  };

  try {
    const bwCommand = new BatchWriteCommand(writeParams);
    await ddbDocClient.send(bwCommand);
  } catch (err) {
    throw err;
  }
}

const ddb = {
  scanAll, getItem, addItem, updateItem, addArrayItem, deleteItem, writeItems
}

export default ddb;
