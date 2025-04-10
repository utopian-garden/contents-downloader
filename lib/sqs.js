// 新しいAWS SDK v3のSQSクライアントをインポートします
import {
  SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand,
  GetQueueAttributesCommand
} from '@aws-sdk/client-sqs';
import sqsConfig from '../config/aws-config-sqs.json' with { type: 'json' };

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

  const response = await sqsClient.send(command);
  return response; // 応答オブジェクトを返すか、必要に応じて加工
};

// MQ からのメッセージ取得と削除
const recvMsg = async (queueUrl) => {
  const recvParams = {
    QueueUrl: queueUrl,
  };
  const command = new ReceiveMessageCommand(recvParams);

  const resRecv = await sqsClient.send(command);
  const { Messages } = resRecv;
  if (Messages && Messages.length > 0) {
    const message = Messages[0]; // 最初のメッセージを取得
    const { ReceiptHandle, Body } = message;
    const delParams = {
      QueueUrl: queueUrl,
      ReceiptHandle: ReceiptHandle,
    };
    const deleteCommand = new DeleteMessageCommand(delParams);
    await sqsClient.send(deleteCommand);
    return JSON.parse(Body);
  }
  return null; // メッセージがない場合はnullを返す
};

// MQ のメッセージ数の取得
const cntMsg = async (queueUrl) => {
  const queParams = {
    QueueUrl: queueUrl,
    AttributeNames: ['ApproximateNumberOfMessages'],
  };
  const command = new GetQueueAttributesCommand(queParams);

  const resQue = await sqsClient.send(command);
  const { ApproximateNumberOfMessages } = resQue.Attributes;
  return parseInt(ApproximateNumberOfMessages, 10);
};

export { sendMsg, recvMsg, cntMsg };
