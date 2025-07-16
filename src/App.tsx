import React from 'react';
import { ChatbotWidget } from '../components/ChatbotWidget';

const App: React.FC = () => {
  return (
    <div>
      <h1>Chatbot Widget Demo</h1>
      <ChatbotWidget apiEndpoint="http://localhost:3000" agentId='53cd3f9a-268b-41b1-a95a-cf31e6b88639' />
    </div>
  );
};

export default App;
