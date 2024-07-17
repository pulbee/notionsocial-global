import {checkTextExceedsTweetCharLimit, hasText, trimString, tweetifyString} from "./text";
import {getMediaFromNotionBlock, parseNotionBlockToText} from "./parser";
import {Content, PublishMedia, TwitterThread} from "./types";

import {
  BlockObjectResponse,
  PartialBlockObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
type NotionBlocksIter = AsyncIterableIterator<
  PartialBlockObjectResponse | BlockObjectResponse
>;
export function getContentFromTextProperty(string, limit = 63206): Content {
  const thread: TwitterThread = [];
  const text = string.substring(0, limit);
  // ? Auto divide the caption text into Thread.
  const [tweets, url] = tweetifyString(text);
  tweets.forEach((tweet, index) => {
    thread.push({text: tweet, media: [], ...(index == 0 && url && {url})});
  });
  return {
    thread,
    text,
    tweetExceededCharLimit: checkTextExceedsTweetCharLimit(string),
    twitter: [],
    paragraphs: [text],
  };
}
export async function getContentFromNotionBlocksAsync(
  blocksIter: NotionBlocksIter
): Promise<Content> {
  const limit = 63206;
  let rawContentArray = [];

  let listIndex = 0;
  for await (const block of blocksIter) {
    listIndex = processNotionBlock(rawContentArray, block, listIndex, limit);
  }
  const [caption, textArray, mediaArray] = processRawContentBlocks(rawContentArray);
  const thread = convertTextToThreads(textArray, mediaArray);

  const content: Content = {
    text: caption,
    paragraphs: textArray,
    thread,
    tweetExceededCharLimit: textArray.some((text) => checkTextExceedsTweetCharLimit(text)),
    twitter: [],
  };

  return content;
}
export async function getContentFromNotionBlocksSync(blocks): Promise<Content> {
  const limit = 63206;
  let rawContentArray = [];

  let listIndex = 0;
  blocks.forEach((block) => {
    listIndex = processNotionBlock(rawContentArray, block, listIndex, limit);
  });

  const [caption, textArray, mediaArray] = processRawContentBlocks(rawContentArray);
  const thread = convertTextToThreads(textArray, mediaArray);

  const content: Content = {
    text: caption,
    paragraphs: textArray,
    thread,
    tweetExceededCharLimit: checkTextExceedsTweetCharLimit(caption),
    twitter: [],
  };

  return content;
}

function processNotionBlock(rawContentArray, block, index: number, limit = 63206) {
  const media = getMediaFromNotionBlock(block);
  if (media) {
    rawContentArray.push(media);
  }

  const isListItem = block.type == "numbered_list_item";
  const isBulletItem = block.type == "bulleted_list_item";
  if (index && !isListItem) index = 0;

  if (isListItem) index++;

  let finalStr = parseNotionBlockToText(block);

  if (finalStr && isListItem) finalStr = `${index}. ${finalStr}`;

  if (finalStr && isBulletItem) finalStr = `• ${finalStr}`;

  const leftLimit = limit - rawContentArray.join("").length;

  if (finalStr.length > leftLimit && finalStr.length < 4) return index;
  const str = finalStr.substring(0, leftLimit);
  if (leftLimit > 0) {
    rawContentArray.push(str);
  }
  return index;
}

function processRawContentBlock(
  block,
  i,
  textArray,
  textArrayLast,
  mediaArray,
  mediaBuffer,
  rawContentArray
) {
  if (block == "---") {
    if (textArrayLast.length > 0) {
      textArray.push(textArrayLast);
      mediaArray.push([...mediaBuffer]);
      mediaBuffer = [];
    }
    textArrayLast = "\n";
  } else if (typeof block == "object") {
    mediaBuffer.push(block);
  } else {
    textArrayLast = textArrayLast.concat(block);
    if (i < rawContentArray.length - 1 && rawContentArray[i + 1] != "---")
      textArrayLast = textArrayLast.concat(`\n`);
    if (i == rawContentArray.length - 1) {
      textArray.push(textArrayLast);
      mediaArray.push([...mediaBuffer]);
      mediaBuffer = [];
    }
  }
  return [textArrayLast, mediaBuffer];
}
function processRawContentBlocks(rawContentArray): [string, string[], PublishMedia[][]] {
  let mediaArray: PublishMedia[][] = [];
  let mediaBuffer: PublishMedia[] = [];
  let textArray: string[] = [];
  let textArrayLast = "";

  rawContentArray.forEach((rawBlock, i) => {
    const [_textArrayLast, _mediaBuffer] = processRawContentBlock(
      rawBlock,
      i,
      textArray,
      textArrayLast,
      mediaArray,
      mediaBuffer,
      rawContentArray
    );
    textArrayLast = _textArrayLast;
    mediaBuffer = _mediaBuffer;
  });
  textArray = textArray
    .map((s) => trimString(s))
    .filter((str, i) => {
      return str.length > 0;
    });
  const caption = textArray.join("\n").trim();
  return [caption, textArray, mediaArray];
}
function convertTextToThreads(textArray, mediaArray): TwitterThread {
  let threads: TwitterThread = [];
  textArray.forEach((str, index) => {
    const [_limitSplitted, url] = tweetifyString(str);
    const _firstSplittedText = _limitSplitted.splice(0, 1)[0];
    threads.push({text: _firstSplittedText, media: mediaArray[index], url: url});
    _limitSplitted.forEach((t) => {
      const trimmedString = t.trim();
      threads.push({text: trimmedString, media: []});
    });
  });
  threads = threads.filter((obj) => {
    return hasText(obj.text) || hasText(obj.url);
  });

  return threads;
}
