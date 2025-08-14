# OpenChatGPTapi<br>
<br>
Backdoor for chatgpt, using web chatgpt as API<br>
<br>
That is the way to walk through API limits by using web version of chatgpt.<br>
No api tokens, no subscription needed.<br>
<br>


# Usage:
1) Upload files<br>
2) Setup npm server (cd /path/to/serverdir , npm i , npm start)<br>
Serves requests for chatGPT<br>
3) Import extension in browser<br>
4) Open chatgpt.com page, open new chat. (you can use Button "Open ChatGPT" in the extension for open new page)<br>
5) Press "Inject". ("Content script" should become "Alive") <br>
6) Done! <br>
<br>
# Testing
After setting up you can test communication "Extension <-> server" and "Extension <-> chat"<br>
Tested on Windows 10 + Yandex browser (probably should work in chromium)<br>

## "Extension <-> server"
<br>
Server "extension connected successfully" output:<br>

## "Extension <-> chat"<br>
Press "Test prompt" button for fast chatting test. If you see prompt sent to chosen model and answer is loading - it works!<br>
<br>
[WS] extension connected from ::ffff:127.0.0.1 <br>
[WS] extension disconnected<br>
[WS<-EXT] hello<br>
[WS] extension disconnected<br>
[WS] extension connected from ::ffff:127.0.0.1<br>
[WS<-EXT] hello<br>

<img width="1227" height="119" alt="image" src="https://github.com/user-attachments/assets/c4553db0-892b-4d3c-8a48-ae0955df5a2c" />

## Normal extension state:<br>
WS URL: ws://127.0.0.1:11435/bridge<br>
WS status: Connected<br>
ChatGPT tab: Open<br>
Content script: Alive<br>
Server health: OK; ext=true; pending=0<br>

## Test from request<br>
One of the purpose of that extension-server: use with agents as an API compatible with OpenAI agent api.<br>
Not tested yet with agents. You can interract with server from your Python (anyth else) code using requests.<br> 
Example with "curl" command: send that command in separate command line window for test (obviously after presetting all stuff)<br>
<br>
curl -X POST http://127.0.0.1:11434/api/generate -H "Content-Type: application/json" -d "{\"model\":\"chatgpt-web\",\"prompt\":\"Напиши мне сортировку пузырьком на Python\",\"stream\":false}"<br>
<br>
You will see sth like that as the request (Chat GPT 5 Fast in example output):<br>
{"model":"chatgpt-web","created_at":"2025-08-14T06:24:22.381Z","response":"Вот простой пример сортировки пузырьком на Python:\npythondef bubble_sort(arr):\n    n = len(arr)\n    for i in range(n):\n        for j in range(0, n - i - 1):\n            if arr[j] > arr[j + 1]:\n                arr[j], arr[j + 1] = arr[j + 1], arr[j]\n    return arr\n\n# Пример использования\ndata = [5, 2, 9, 1, 5, 6]\nprint(bubble_sort(data))  # [1, 2, 5, 5, 6, 9]\n\nХочешь, я сделаю версию с оптимизацией, чтобы она прекращала работу, если массив уже отсортирован?","done":true,"total_duration":0,"eval_count":460}<br>
<br>
Then parse the answer for your purposes. Enjoy!<br>

<img width="363" height="177" alt="image" src="https://github.com/user-attachments/assets/f9ffafb4-d7e8-4e22-be09-b7f1a1df66b6" />


