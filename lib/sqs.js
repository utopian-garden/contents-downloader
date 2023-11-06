'use strict';

// 新しいAWS SDK v3のSQSクライアントをインポートします
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import sqsConfig from '../config/aws-config-sqs.json' assert { type: 'json' };

// SQSクライアントのインスタンスを作成します
const sqsClient = new SQSClient(sqsConfig);

// MQ へのメッセージ送信
const sendMsg = async (queueUrl, msgBody) => {
  const sendParams = {
    MessageBody: msgBody,
    QueueUrl: queueUrl,
    DelaySeconds: 0,
  };
  const command = new SendMessageCommand(sendParams);

  try {
    const response = await sqsClient.send(command);
    return response; // 応答オブジェクトを返すか、必要に応じて加工
  } catch (err) {
    throw err;
  }
};

// MQ からのメッセージ取得と削除
const recvMsg = async (queueUrl) => {
  const recvParams = {
    QueueUrl: queueUrl,
  };
  const command = new ReceiveMessageCommand(recvParams);

  try {
    const resRecv = await sqsClient.send(command);
    if (resRecv.Messages && resRecv.Messages.length > 0) {
      const message = resRecv.Messages[0]; // 最初のメッセージを取得
      const delParams = {
        QueueUrl: queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      };
      const deleteCommand = new DeleteMessageCommand(delParams);
      await sqsClient.send(deleteCommand);
      return JSON.parse(message.Body);
    }
    return null; // メッセージがない場合はnullを返す
  } catch (err) {
    throw err;
  }
};

// MQ のメッセージ数の取得
const cntMsg = async (queueUrl) => {
  const queParams = {
    QueueUrl: queueUrl,
    AttributeNames: ["ApproximateNumberOfMessages"],
  };
  const command = new GetQueueAttributesCommand(queParams);

  try {
    const resQue = await sqsClient.send(command);
    return parseInt(resQue.Attributes.ApproximateNumberOfMessages, 10);
  } catch (err) {
    throw err;
  }
};

const sqs = { sendMsg, recvMsg, cntMsg };
export default sqs;
