import { Toaster } from './components/ui/toaster';
import './App.css';
import VideoChat from './pages/VideoChat';

function App() {
  return (
    <div className="App">
      <VideoChat />
      <Toaster />
    </div>
  );
}

export default App;