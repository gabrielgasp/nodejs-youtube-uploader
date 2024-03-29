// IMPORTS
import 'dotenv/config';
import fs from 'fs/promises';
import readline from 'readline';
import chalk from 'chalk';
import { google, youtube_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// GLOBAL CONSTS
const SCOPES = ['https://www.googleapis.com/auth/youtube'];
const TOKEN_PATH = './client_oauth_token.json';
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const CLIENT_ID = process.env.CLIENT_ID;
const PLAYLIST_ID_TO_INSERT_VIDEOS = process.env.PLAYLIST_ID_TO_INSERT_VIDEOS;
const OAUTH2 = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, 'http://localhost');

// FUNCTIONS DECLARATIONS
async function ask (question: string) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return await new Promise<string>(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function getAuth () {
  const cachedToken = await fs.readFile(TOKEN_PATH, 'utf8').catch(() => null);

  if (cachedToken) return OAUTH2.setCredentials(JSON.parse(cachedToken));

  const authUrl = OAUTH2.generateAuthUrl({ scope: SCOPES });

  console.log(chalk.yellowBright('\nAuthorize this app by visiting the url below:\n'));
  console.log(chalk.blueBright(authUrl));

  const code = await ask(chalk.yellowBright(
    "\nAfter the authorization, get the code from the new page's url and paste it here: "
  ));

  const { tokens: newToken } = await OAUTH2.getToken(code);

  OAUTH2.setCredentials(newToken);

  await fs.writeFile(TOKEN_PATH, JSON.stringify(newToken, null, 2));
}

async function getUploadedVideosPlaylistId (youtube: youtube_v3.Youtube) {
  const channel = await youtube.channels.list({
    part: ['contentDetails'],
    mine: true
  });

  if (
    !channel.data.items ||
    !channel.data.items[0].contentDetails?.relatedPlaylists?.uploads
  ) {
    throw new Error('Failed to get upload videos paylist id')
  }

  return channel.data.items[0].contentDetails.relatedPlaylists.uploads;
}

async function getPlaylistVideos (youtube: youtube_v3.Youtube, playlistId: string) {
  const playlistItems = await youtube.playlistItems.list({
    part: ['snippet'],
    playlistId,
    maxResults: 50
  });

  if (!playlistItems.data.items) return [];

  return playlistItems.data.items;
}

async function filterRenameAndSortNewVideos (
  videos: youtube_v3.Schema$PlaylistItem[]
): Promise<youtube_v3.Schema$PlaylistItem[]> {
  const module = await ask(chalk.yellowBright('\nEnter the module number: '));

  const moduleInt = Math.abs(parseInt(module));

  if (isNaN(moduleInt)) {
    console.log(chalk.magentaBright('\nModule number must be an integer, try again'));
    return await filterRenameAndSortNewVideos(videos);
  }

  const filteredAndRenamedVideos = videos.filter((video) => {
    if (!video.snippet?.title) return false;

    const title = video.snippet?.title;
    if (video.snippet.title.includes('.')) return false;

    video.snippet.title = title.startsWith('0')
      ? `${module}.${title.slice(1)}`
      : `${module}.${title}`;

    return true;
  });

  const sortedVideos = filteredAndRenamedVideos.sort((a, b) => {
    if (!a.snippet?.title || !b.snippet?.title) return 0;
    const sliceStart = module.length + 1;
    return parseInt(a.snippet.title.slice(sliceStart)) - parseInt(b.snippet.title.slice(sliceStart));
  });

  return sortedVideos;
}

async function editVideo (youtube: youtube_v3.Youtube, videoId: string, title: string) {
  const { status } = await youtube.videos.update({
    part: ['snippet', 'status'],
    requestBody: {
      id: videoId,
      snippet: {
        title,
        categoryId: '22'
      },
      status: {
        privacyStatus: 'private',
        selfDeclaredMadeForKids: false
      }
    }
  });

  if (status === 200) {
    console.log(chalk.greenBright(`\nVideo ${title} edited`));
  } else {
    console.log(chalk.redBright(`\nFailed to edit video ${title}`));
  }
}

async function insertVideoInPlaylist (youtube: youtube_v3.Youtube, videoId: string, title: string) {
  const { status } = await youtube.playlistItems.insert({
    part: ['snippet'],
    requestBody: {
      snippet: {
        playlistId: PLAYLIST_ID_TO_INSERT_VIDEOS,
        resourceId: {
          kind: 'youtube#video',
          videoId
        }
      }
    }
  });

  if (status === 200) {
    console.log(chalk.greenBright(`Video ${title} inserted in the playlist`));
  } else {
    console.log(chalk.redBright(`Failed to insert video ${title} in the playlist`));
  }
}

async function main () {
  try {
    if (!CLIENT_SECRET || !CLIENT_ID || !PLAYLIST_ID_TO_INSERT_VIDEOS) {
      throw new Error('Missing env vars, please check .env.example');
    }

    await getAuth();

    const youtube = google.youtube({ version: 'v3', auth: OAUTH2 });

    const uploadedVideosPaylistId = await getUploadedVideosPlaylistId(youtube)

    const uploadedVideosPaylistVideos = await getPlaylistVideos(youtube, uploadedVideosPaylistId);

    const videosToUpdate = await filterRenameAndSortNewVideos(uploadedVideosPaylistVideos);

    if (!videosToUpdate.length) return console.log('No videos to updated');

    for (const video of videosToUpdate) {
      if (!video.snippet?.title || !video.snippet?.resourceId?.videoId) continue;

      const videoId = video.snippet.resourceId.videoId;

      const newTitle = video.snippet.title;

      await editVideo(youtube, videoId, newTitle);

      await insertVideoInPlaylist(youtube, videoId, newTitle);
    }
    console.log(chalk.cyanBright('\nDone! 🎉\n'));
  } catch (error: unknown) {
    console.log(chalk.redBright(error)); // this only prints the message because of chalk
    console.log(error);
  }
}

// INIT
void main();
