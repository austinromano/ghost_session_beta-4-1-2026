#include "GhostWebView.h"
#include "GhostLog.h"
#include "../Core/PluginProcessor.h"

GhostWebView::GhostWebView(const Options& options, GhostSessionProcessor& processor)
    : WebBrowserComponent(options), proc(processor)
{
    tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                  .getChildFile("GhostSession");
    if (!tempDir.exists())
        tempDir.createDirectory();

    // Push audio levels to JS at ~30fps
    startTimerHz(30);
}

bool GhostWebView::pageAboutToLoad(const juce::String& newURL)
{
    if (newURL.startsWith("ghost://drag-to-daw"))
    {
        GhostLog::write("[WebView] Intercepted drag-to-daw request");
        handleDragToDaw(newURL);
        return false;
    }

    if (newURL.startsWith("ghost://start-recording"))
    {
        GhostLog::write("[WebView] Intercepted start-recording");
        handleStartRecording();
        return false;
    }

    if (newURL.startsWith("ghost://stop-recording"))
    {
        GhostLog::write("[WebView] Intercepted stop-recording");
        handleStopRecording();
        return false;
    }

    return true;
}

void GhostWebView::timerCallback()
{
    float left  = proc.inputLevelLeft.load(std::memory_order_relaxed);
    float right = proc.inputLevelRight.load(std::memory_order_relaxed);
    bool isRec  = proc.isRecording();

    // Clamp to 0-1
    left  = juce::jlimit(0.0f, 1.0f, left);
    right = juce::jlimit(0.0f, 1.0f, right);

    juce::String js = "if(window.__ghostAudioLevels__){window.__ghostAudioLevels__("
                    + juce::String(left, 4) + ","
                    + juce::String(right, 4) + ","
                    + (isRec ? "true" : "false") + ");}";

    executeScript(js);
}

void GhostWebView::handleStartRecording()
{
    proc.startRecording();
}

void GhostWebView::handleStopRecording()
{
    proc.stopRecording();

    auto recordedFile = proc.getLastRecordedFile();
    if (recordedFile.existsAsFile())
    {
        GhostLog::write("[WebView] Recording saved: " + recordedFile.getFullPathName());

        // Tell the React UI the file is ready
        auto filePath = recordedFile.getFullPathName().replace("\\", "\\\\");
        auto fileName = recordedFile.getFileName();
        auto sizeKB = juce::String(recordedFile.getSize() / 1024);

        juce::String js = "if(window.__ghostRecordingComplete__){window.__ghostRecordingComplete__('"
                        + fileName + "'," + sizeKB + ");}";
        executeScript(js);
    }
}

juce::String GhostWebView::getQueryParam(const juce::String& url, const juce::String& paramName)
{
    auto search = paramName + "=";
    int startIdx = url.indexOf(search);

    if (startIdx < 0)
        return {};

    startIdx += search.length();
    int endIdx = url.indexOf(startIdx, "&");

    if (endIdx < 0)
        endIdx = url.length();

    return juce::URL::removeEscapeChars(url.substring(startIdx, endIdx));
}

void GhostWebView::handleDragToDaw(const juce::String& urlString)
{
    auto downloadUrl = getQueryParam(urlString, "url");
    auto fileName = getQueryParam(urlString, "fileName");

    if (downloadUrl.isEmpty() || fileName.isEmpty())
    {
        GhostLog::write("[WebView] drag-to-daw missing url or fileName param");
        return;
    }

    GhostLog::write("[WebView] Downloading: " + fileName);
    auto localFile = downloadToTemp(downloadUrl, fileName);

    if (localFile.existsAsFile())
    {
        GhostLog::write("[WebView] Starting native drag: " + localFile.getFullPathName());

        auto filePath = localFile.getFullPathName();
        auto safeThis = juce::Component::SafePointer<GhostWebView>(this);

        juce::MessageManager::callAsync([filePath, safeThis]()
        {
            if (safeThis == nullptr)
            {
                GhostLog::write("[WebView] Plugin destroyed before drag could start");
                return;
            }

            GhostLog::write("[WebView] Executing native drag on message thread");
            juce::DragAndDropContainer::performExternalDragDropOfFiles(
                { filePath }, false, safeThis.getComponent());
        });
    }
    else
    {
        GhostLog::write("[WebView] Download failed for: " + fileName);
    }
}

juce::File GhostWebView::downloadToTemp(const juce::String& downloadUrl, const juce::String& fileName)
{
    auto destFile = tempDir.getChildFile(fileName);

    if (destFile.existsAsFile() && destFile.getSize() > 0)
    {
        GhostLog::write("[WebView] Using cached file: " + destFile.getFullPathName());
        return destFile;
    }

    juce::URL url(downloadUrl);
    auto stream = url.createInputStream(
        juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
            .withConnectionTimeoutMs(15000));

    if (stream != nullptr)
    {
        juce::FileOutputStream fos(destFile);

        if (fos.openedOk())
        {
            fos.writeFromInputStream(*stream, -1);
            fos.flush();
            GhostLog::write("[WebView] Downloaded " + juce::String(destFile.getSize()) + " bytes");
        }
    }

    return destFile;
}
