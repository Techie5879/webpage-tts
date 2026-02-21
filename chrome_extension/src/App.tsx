import { SettingsProvider } from "@/SettingsContext";
import { PlaybackProvider } from "@/PlaybackContext";
import V5Accordion from "@/variants/V5Accordion";

function App() {
  return (
    <SettingsProvider>
      <PlaybackProvider>
        <V5Accordion />
      </PlaybackProvider>
    </SettingsProvider>
  );
}

export default App;
