import express from "express";
import server from "http";
import { AceBaseServer } from "acebase-server";
import { Server } from "socket.io";
import { Configuration, OpenAIApi } from "openai";
import dotenv from "dotenv";

dotenv();

const app = express();

const httpServer = server.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const acebase = new AceBaseServer("db");
const { db } = acebase;

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const basePrompt = ```
You are Diogenes GPT. Your task is to make sarcastic interactions in between conversations 
between two people. You have multiple modes to choose from on how you can interact. Try to embarrass them, but respect the limitations of the mode. 
Your jokes should be relevant to the conversation. You're given one of the following modes:

1. Ghost Mode: You will be given the last 8 messages of the conversation and you have to make a sarcastic comment to the user with the given id.
2. Interactive Mode: You will be given the last 8 messages of the conversation and you have to make a sarcastic comment as if you were the third person.
3. Troll Mode: You will be given the last 8 messages and a message to modify. Make the message embarrassing and funny. 
```;

const messages = db.ref("messages");

const ghost = db.ref("ghost");

const createCompletion = async (prompt) => {
  return (
    await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [prompt],
    })
  ).data.choices[0].message;
};

const randomExec = (probability, callback) => {
  const max = 1 / probability;

  const randomNumber = Math.floor(Math.random() * max);
  if (randomNumber == 0) {
    callback();
  }
};

const createAICompletions = async (mode, userId, message, callback) => {
  const history = (await messages.get()).val().slice(-8).join("\n");
  const prompt = `${basePrompt}\n\nMode: ${mode}\n\nChat history: ${history}\n\nUser: ${userId}`;

  const pushUserMessage = () => {
    messages.push({ userId, message });
  };
  if (mode === "ghost") {

    randomExec(1 / 6, () => {
      const sarcasticRemark = createCompletion(prompt);

      ghost.push({ userId, sarcasticRemark });
    });

    pushUserMessage();
  } else if (mode === "interactive") {
    // Send the user's message first
    pushUserMessage();

    randomExec(1 / 6, () => {
      const sarcasticRemark = createCompletion(prompt);

      messages.push({ userId, sarcasticRemark });
    });
  } else if (mode === "troll") {
    const modifiedMessage = createCompletion(
      prompt + `\n\nMessage to modify: ${message}`
    );

    messages.push({ userId, modifiedMessage });

    // no user message here since this is the users message
  }
};

db.ready(() => {
  console.log("DB Ready");

  io.on("connection", (socket) => {
    console.log("User connected");

    socket.on("disconnect", () => {
      console.log("Client Disconnected");
    });

    socket.on("message", (data) => {
      const { userId, message, mode } = data;

      console.log("Message Received", message, userId, mode);

      createAICompletions(mode, userId, message);
    });

    messages.on("child_added", (msg) => {
      socket.emit("message_board", msg.val());
    });

    ghost.on("child_added", (msg) => {
      socket.emit("ghost_board", msg.val());
    });
    
  });
});

httpServer.listen(8080, () => {
  console.log("Server running on port 8080");
});
