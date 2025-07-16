import React, { useState, useEffect, useRef } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { FlowiseClient } from 'flowise-sdk';
import './ChatbotWidget.css';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';


type ChatMessage = {
  role: 'user' | 'system';
  content: string;
};

interface ChatbotWidgetProps {
  apiEndpoint: string;
  agentId: string;
}

export const ChatbotWidget: React.FC<ChatbotWidgetProps> = ({ apiEndpoint, agentId }) => {

  // Initialize FlowiseClient instance
  const flowise = new FlowiseClient({ baseUrl: apiEndpoint });
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialMessage = 'Hello! I am SVAI, your AI assistant. How can I help you today?';
  const sessionId = localStorage.getItem('chatSessionId') || crypto.randomUUID();
  localStorage.setItem('chatSessionId', sessionId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') sendMessage();
  };

  const parseCsv = (text: string): Promise<any[]> => {
    return new Promise((resolve) => {
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve(results.data),
      });
    });
  };

  const parseExcel = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(sheet);
        resolve(json);
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  const recordsToDocString = (fileName: string, records: any[]): string => {
    let result = `<doc name='${fileName}'>`;
    records.forEach((record, idx) => {
      result += `id: ${idx + 1}\\n`;
      Object.entries(record).forEach(([key, value]) => {
        result += `${key}: ${value}\\n`;
      });
    });
    result += `</doc>`;
    return result;
  };

  useEffect(() => {
    setMessages([{ role: 'system', content: initialMessage }]);
  }, []);

  const sendMessage = async () => {
    if (!input.trim() && !selectedFile) return;

    let finalInput = '';

    try {
      if (selectedFile) {
        let docString = '';

        if (selectedFile.name.endsWith('.csv')) {
          const text = await selectedFile.text();
          const records = await parseCsv(text);
          docString = recordsToDocString(selectedFile.name, records);

        } else if (selectedFile.name.endsWith('.xlsx') || selectedFile.name.endsWith('.xls')) {
          const records = await parseExcel(selectedFile);
          docString = recordsToDocString(selectedFile.name, records);

        } else if (selectedFile.name.endsWith('.txt')) {
          const text = await selectedFile.text();
          const escapedText = text.replace(/\r?\n/g, '\\n');
          docString = `<doc name='${selectedFile.name}'>${escapedText}</doc>`;
        }

        finalInput = docString;
      }

      const combinedQuestion = finalInput + '\n\n\n' + input;
      

      setMessages((prev) => [
        ...prev,
        { role: 'user', content: input || selectedFile?.name || '' },
        { role: 'system', content: 'Thinking...' }, 
      ]);
      setInput('');
      setSelectedFile(null);
      setLoading(true);

      const prediction = await flowise.createPrediction({
        chatflowId: agentId,
        question: combinedQuestion,
        streaming: true,
        overrideConfig: {
          sessionId: sessionId
        }
      });

      for await (const chunk of prediction) {
        if (chunk.event === 'token' && chunk.data) {
          setMessages((prev) =>
            prev.map((msg, i) =>
              i === prev.length - 1
                ? {
                    ...msg,
                    content:
                      prev[prev.length - 1]?.content === 'Thinking...'
                        ? chunk.data
                        : (prev[prev.length - 1]?.content || '') + chunk.data,
                  }
                : msg
            )
          );
        } else if (chunk.event === 'error' && chunk.data) {
          console.error('Flowise error:', chunk.data);
          setMessages((prev) => [
            ...prev,
            { role: 'system', content: '⚠️ Error: Please contact suppport.' },
          ]);
          setLoading(false);
          break; // stop processing further
        }
      }



      setLoading(false);
    } catch (err) {
      console.error('Flowise error:', err);
      setMessages((prev) => [
        ...prev,
        { role: 'system', content: '⚠️ Error contacting Flowise.' },
      ]);
      setLoading(false);
    }
  };


  return (
    <div className="chatbot-container">
      {isOpen ? (
        <div className={`chatbot-window ${isOpen ? 'open' : 'closed'}`}>
          <div className="chatbot-header">
            SVAI
            <button
              onClick={() => setIsOpen(false)}
              className="chatbot-minimize-button"
              title="Minimize"
            >
              _
            </button>
          </div>

          <div className="chatbot-messages">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`chatbot-message chatbot-fade-in ${
                  m.role === 'user' ? 'user' : 'system'
                }`}
              >
                <div
                  className={`chatbot-message-content ${
                    m.content === 'Thinking...' ? 'chatbot-typing-dots' : ''
                  }`}
                >
                  {m.content === 'Thinking...' ? 'Thinking' : m.content}
                </div>
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>

          {selectedFile && (
            <div className="chatbot-file-chip">
              <span className="chatbot-file-icon">
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M18.7103,17.5652 C20.37,15.9055 20.37,13.2145 18.7103,11.5548 L12.1696,5.01406 C11.7791,4.62353 11.7791,3.99037 12.1696,3.59984 C12.5601,3.20932 13.1933,3.20932 13.5838,3.59984 L20.1245,10.1406 C22.5653,12.5814 22.5653,16.5386 20.1245,18.9794 C17.6838,21.4202 13.7265,21.4202 11.2857,18.9794 L3.33178,11.0255 C1.57385,9.26757 1.57385,6.4174 3.33178,4.65947 C5.08971,2.90154 7.93988,2.90154 9.69781,4.65947 L17.6507,12.6123 C18.7252,13.6869 18.7252,15.429 17.6507,16.5035 C16.5762,17.578 14.834,17.578 13.7595,16.5035 L6.51272,9.2567 C6.1222,8.86617 6.1222,8.23301 6.51272,7.84248 C6.90325,7.45196 7.53641,7.45196 7.92694,7.84248 L15.1737,15.0893 C15.4672,15.3828 15.943,15.3828 16.2365,15.0893 C16.5299,14.7958 16.5299,14.32 16.2365,14.0266 L8.2836,6.07368 C7.30671,5.0968 5.72287,5.0968 4.74599,6.07368 C3.76911,7.05056 3.76911,8.6344 4.74599,9.61129 L12.6999,17.5652 C14.3596,19.2249 17.0506,19.2249 18.7103,17.5652 Z" />
                </svg>
              </span>
              <span className="chatbot-file-name">{selectedFile.name}</span>
            </div>
          )}

          <div className="chatbot-input-area">
            <label className="chatbot-attach-button">
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="#f58a42"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M18.7103,17.5652 C20.37,15.9055 20.37,13.2145 18.7103,11.5548 L12.1696,5.01406 C11.7791,4.62353 11.7791,3.99037 12.1696,3.59984 C12.5601,3.20932 13.1933,3.20932 13.5838,3.59984 L20.1245,10.1406 C22.5653,12.5814 22.5653,16.5386 20.1245,18.9794 C17.6838,21.4202 13.7265,21.4202 11.2857,18.9794 L3.33178,11.0255 C1.57385,9.26757 1.57385,6.4174 3.33178,4.65947 C5.08971,2.90154 7.93988,2.90154 9.69781,4.65947 L17.6507,12.6123 C18.7252,13.6869 18.7252,15.429 17.6507,16.5035 C16.5762,17.578 14.834,17.578 13.7595,16.5035 L6.51272,9.2567 C6.1222,8.86617 6.1222,8.23301 6.51272,7.84248 C6.90325,7.45196 7.53641,7.45196 7.92694,7.84248 L15.1737,15.0893 C15.4672,15.3828 15.943,15.3828 16.2365,15.0893 C16.5299,14.7958 16.5299,14.32 16.2365,14.0266 L8.2836,6.07368 C7.30671,5.0968 5.72287,5.0968 4.74599,6.07368 C3.76911,7.05056 3.76911,8.6344 4.74599,9.61129 L12.6999,17.5652 C14.3596,19.2249 17.0506,19.2249 18.7103,17.5652 Z" />
              </svg>
              <input
                type="file"
                accept=".csv, .txt, .xlsx, .xls"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                disabled={loading}
              />
            </label>

            <input
              className="chatbot-input"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type your question..."
              disabled={loading}
            />
            <button onClick={sendMessage} className="chatbot-send-button" disabled={loading}>
              ➤
            </button>
          </div>
        </div>
      ) : (
        <button
          className="chatbot-toggle-button"
          onClick={() => setIsOpen(true)}
          title="Open Chat"
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.5997 2.37562 15.1116 3.04346 16.4525C3.22094 16.8088 3.28001 17.2161 3.17712 17.6006L2.58151 19.8267C2.32295 20.793 3.20701 21.677 4.17335 21.4185L6.39939 20.8229C6.78393 20.72 7.19121 20.7791 7.54753 20.9565C8.88837 21.6244 10.4003 22 12 22Z" stroke="#ffffff" stroke-width="1.5"></path> <path opacity="0.5" d="M12 16V8" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M8 14V10" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"></path> <path opacity="0.5" d="M16 14V10" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"></path> </g></svg>
        </button>
      )}
    </div>
  );
};
