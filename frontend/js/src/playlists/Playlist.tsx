/* eslint-disable jsx-a11y/anchor-is-valid,camelcase */

import { saveAs } from "file-saver";
import { findIndex, omit } from "lodash";
import * as React from "react";
import { createRoot } from "react-dom/client";

import { faCog, faPlusCircle } from "@fortawesome/free-solid-svg-icons";

import { sanitizeUrl } from "@braintree/sanitize-url";
import NiceModal from "@ebay/nice-modal-react";
import { IconProp } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import * as Sentry from "@sentry/react";
import { Integrations } from "@sentry/tracing";
import { sanitize } from "dompurify";
import { ReactSortable } from "react-sortablejs";
import { toast } from "react-toastify";
import { io, Socket } from "socket.io-client";
import BrainzPlayer from "../brainzplayer/BrainzPlayer";
import Card from "../components/Card";
import Loader from "../components/Loader";
import withAlertNotifications from "../notifications/AlertNotificationsHOC";
import { ToastMsg } from "../notifications/Notifications";
import APIServiceClass from "../utils/APIService";
import ErrorBoundary from "../utils/ErrorBoundary";
import GlobalAppContext from "../utils/GlobalAppContext";
import SearchTrackOrMBID from "../utils/SearchTrackOrMBID";
import { getPageProps } from "../utils/utils";
import CreateOrEditPlaylistModal from "./CreateOrEditPlaylistModal";
import DeletePlaylistConfirmationModal from "./DeletePlaylistConfirmationModal";
import PlaylistItemCard from "./PlaylistItemCard";
import PlaylistMenu from "./PlaylistMenu";
import {
  getPlaylistExtension,
  getPlaylistId,
  getRecordingMBIDFromJSPFTrack,
  isPlaylistOwner,
  JSPFTrackToListen,
  MUSICBRAINZ_JSPF_PLAYLIST_EXTENSION,
  PLAYLIST_TRACK_URI_PREFIX,
  PLAYLIST_URI_PREFIX,
} from "./utils";

export type PlaylistPageProps = {
  playlist: JSPFObject;
};

export interface PlaylistPageState {
  playlist: JSPFPlaylist;
  loading: boolean;
}

type OptionType = { label: string; value: ACRMSearchResult };

export default class PlaylistPage extends React.Component<
  PlaylistPageProps,
  PlaylistPageState
> {
  static contextType = GlobalAppContext;

  static makeJSPFTrack(trackMetadata: TrackMetadata): JSPFTrack {
    return {
      identifier: `${PLAYLIST_TRACK_URI_PREFIX}${
        trackMetadata.recording_mbid ??
        trackMetadata.additional_info?.recording_mbid
      }`,
      title: trackMetadata.track_name,
      creator: trackMetadata.artist_name,
    };
  }

  declare context: React.ContextType<typeof GlobalAppContext>;
  private APIService!: APIServiceClass;

  private socket!: Socket;

  constructor(props: PlaylistPageProps) {
    super(props);

    // React-SortableJS expects an 'id' attribute and we can't change it, so add it to each object
    // eslint-disable-next-line no-unused-expressions
    props.playlist?.playlist?.track?.forEach(
      (jspfTrack: JSPFTrack, index: number) => {
        // eslint-disable-next-line no-param-reassign
        jspfTrack.id = getRecordingMBIDFromJSPFTrack(jspfTrack);
      }
    );
    this.state = {
      playlist: props.playlist?.playlist || {},
      loading: false,
    };
  }

  async componentDidMount(): Promise<void> {
    const { APIService } = this.context;
    this.APIService = APIService;
    this.connectWebsockets();
  }

  componentWillUnmount(): void {
    if (this.socket?.connected) {
      this.socket.disconnect();
    }
  }

  connectWebsockets = (): void => {
    // Do we want to show live updates for everyone, or just owner & collaborators?
    this.createWebsocketsConnection();
    this.addWebsocketsHandlers();
  };

  createWebsocketsConnection = (): void => {
    this.socket = io(`${window.location.origin}`, { path: "/socket.io/" });
  };

  addWebsocketsHandlers = (): void => {
    this.socket.on("connect", () => {
      const { playlist } = this.state;
      this.socket.emit("joined", {
        playlist_id: getPlaylistId(playlist),
      });
    });
    this.socket.on("playlist_changed", (data: JSPFPlaylist) => {
      this.handlePlaylistChange(data);
    });
  };

  emitPlaylistChanged = (): void => {
    const { playlist } = this.state;
    this.socket.emit("change_playlist", playlist);
  };

  handlePlaylistChange = (data: JSPFPlaylist): void => {
    const newPlaylist = data;
    // rerun fetching metadata for all tracks?
    // or find new tracks and fetch metadata for them, add them to local Map

    // React-SortableJS expects an 'id' attribute and we can't change it, so add it to each object
    // eslint-disable-next-line no-unused-expressions
    newPlaylist?.track?.forEach((jspfTrack: JSPFTrack, index: number) => {
      // eslint-disable-next-line no-param-reassign
      jspfTrack.id = getRecordingMBIDFromJSPFTrack(jspfTrack);
    });
    this.setState({ playlist: newPlaylist });
  };

  addTrack = async (selectedTrackMetadata: TrackMetadata): Promise<void> => {
    if (!selectedTrackMetadata) {
      return;
    }
    const { playlist } = this.state;
    const { currentUser } = this.context;
    if (!currentUser?.auth_token) {
      this.alertMustBeLoggedIn();
      return;
    }
    if (!this.hasRightToEdit()) {
      this.alertNotAuthorized();
      return;
    }
    try {
      const jspfTrack = PlaylistPage.makeJSPFTrack(selectedTrackMetadata);
      await this.APIService.addPlaylistItems(
        currentUser.auth_token,
        getPlaylistId(playlist),
        [jspfTrack]
      );
      toast.success(
        <ToastMsg
          title="Added Track"
          message={`${selectedTrackMetadata.track_name} by ${selectedTrackMetadata.artist_name}`}
        />,
        { toastId: "added-track" }
      );
      jspfTrack.id = selectedTrackMetadata.recording_mbid;
      this.setState(
        {
          playlist: { ...playlist, track: [...playlist.track, jspfTrack] },
        },
        this.emitPlaylistChanged
      );
    } catch (error) {
      this.handleError(error);
    }
  };

  deletePlaylist = async (): Promise<void> => {
    const { currentUser } = this.context;
    const { playlist } = this.state;
    if (!currentUser?.auth_token) {
      this.alertMustBeLoggedIn();
      return;
    }
    if (isPlaylistOwner(playlist, currentUser)) {
      this.alertNotAuthorized();
      return;
    }
    try {
      await this.APIService.deletePlaylist(
        currentUser.auth_token,
        getPlaylistId(playlist)
      );
      // redirect
      toast.success(
        <ToastMsg
          title="Deleted playlist"
          message={`Deleted playlist ${playlist.title}`}
        />,
        { toastId: "delete-playlist-success" }
      );

      // Wait 1.5 second before navigating to user playlists page
      await new Promise((resolve) => {
        setTimeout(resolve, 1500);
      });
      window.location.href = `${window.location.origin}/user/${currentUser.name}/playlists`;
    } catch (error) {
      this.handleError(error);
    }
  };

  hasRightToEdit = (): boolean => {
    const { currentUser } = this.context;
    const { playlist } = this.state;
    const collaborators = getPlaylistExtension(playlist)?.collaborators ?? [];
    if (!isPlaylistOwner(playlist, currentUser)) {
      return true;
    }
    return (
      collaborators.findIndex(
        (collaborator) => collaborator === currentUser?.name
      ) >= 0
    );
  };

  deletePlaylistItem = async (trackToDelete: JSPFTrack) => {
    const { currentUser } = this.context;
    const { playlist } = this.state;
    const { track: tracks } = playlist;
    if (!currentUser?.auth_token) {
      this.alertMustBeLoggedIn();
      return;
    }
    if (!this.hasRightToEdit()) {
      this.alertNotAuthorized();
      return;
    }
    const recordingMBID = getRecordingMBIDFromJSPFTrack(trackToDelete);
    const trackIndex = findIndex(tracks, trackToDelete);
    try {
      const status = await this.APIService.deletePlaylistItems(
        currentUser.auth_token,
        getPlaylistId(playlist),
        recordingMBID,
        trackIndex
      );
      if (status === 200) {
        tracks.splice(trackIndex, 1);
        this.setState(
          {
            playlist: {
              ...playlist,
              track: [...tracks],
            },
          },
          this.emitPlaylistChanged
        );
      }
    } catch (error) {
      this.handleError(error);
    }
  };

  movePlaylistItem = async (evt: any) => {
    const { currentUser } = this.context;
    const { playlist } = this.state;
    if (!currentUser?.auth_token) {
      this.alertMustBeLoggedIn();
      return;
    }
    if (!this.hasRightToEdit()) {
      this.alertNotAuthorized();
      return;
    }
    try {
      await this.APIService.movePlaylistItem(
        currentUser.auth_token,
        getPlaylistId(playlist),
        evt.item.getAttribute("data-recording-mbid"),
        evt.oldIndex,
        evt.newIndex,
        1
      );
      this.emitPlaylistChanged();
    } catch (error) {
      this.handleError(error);
      // Revert the move in state.playlist order
      const newTracks = [...playlist.track];
      // The ol' switcheroo !
      const toMoveBack = newTracks[evt.newIndex];
      newTracks[evt.newIndex] = newTracks[evt.oldIndex];
      newTracks[evt.oldIndex] = toMoveBack;

      this.setState({ playlist: { ...playlist, track: newTracks } });
    }
  };

  editPlaylist = async (
    name: string,
    description: string,
    isPublic: boolean,
    collaborators: string[],
    id?: string
  ) => {
    if (!id) {
      toast.error(
        <ToastMsg
          title="Error"
          message={
            "Trying to edit a playlist without an id. This shouldn't have happened, please contact us with the error message."
          }
        />,
        { toastId: "edit-playlist-error" }
      );
      return;
    }
    const { currentUser } = this.context;
    if (!currentUser?.auth_token) {
      this.alertMustBeLoggedIn();
      return;
    }
    const { playlist } = this.state;
    // Owner can't be collaborator
    const collaboratorsWithoutOwner = collaborators.filter(
      (username) => username.toLowerCase() !== playlist.creator.toLowerCase()
    );
    if (isPlaylistOwner(playlist, currentUser)) {
      this.alertNotAuthorized();
      return;
    }
    if (
      description === playlist.annotation &&
      name === playlist.title &&
      isPublic ===
        playlist.extension?.[MUSICBRAINZ_JSPF_PLAYLIST_EXTENSION]?.public &&
      collaboratorsWithoutOwner ===
        playlist.extension?.[MUSICBRAINZ_JSPF_PLAYLIST_EXTENSION]?.collaborators
    ) {
      // Nothing changed
      return;
    }
    try {
      const editedPlaylist: JSPFPlaylist = {
        ...playlist,
        annotation: description,
        title: name,
        extension: {
          [MUSICBRAINZ_JSPF_PLAYLIST_EXTENSION]: {
            public: isPublic,
            collaborators: collaboratorsWithoutOwner,
          },
        },
      };

      await this.APIService.editPlaylist(currentUser.auth_token, id, {
        playlist: omit(editedPlaylist, "track") as JSPFPlaylist,
      });
      this.setState({ playlist: editedPlaylist }, this.emitPlaylistChanged);
      toast.success(
        <ToastMsg
          title="Saved playlist"
          message={`Saved playlist ${playlist.title}`}
        />,
        { toastId: "saved-playlist" }
      );
    } catch (error) {
      this.handleError(error);
    }
  };

  alertMustBeLoggedIn = () => {
    toast.error(
      <ToastMsg
        title="Error"
        message="You must be logged in for this operation"
      />,
      { toastId: "auth-error" }
    );
  };

  alertNotAuthorized = () => {
    toast.error(
      <ToastMsg
        title="Not allowed"
        message="You are not authorized to modify this playlist"
      />,
      { toastId: "auth-error" }
    );
  };

  handleError = (error: any) => {
    toast.error(<ToastMsg title="Error" message={error.message} />, {
      toastId: "error",
    });
  };

  exportAsXSPF = async (
    playlistId: string,
    playlistTitle: string,
    auth_token: string
  ) => {
    const result = await this.APIService.exportPlaylistToXSPF(
      auth_token,
      playlistId
    );
    saveAs(result, `${playlistTitle}.xspf`);
  };

  render() {
    const { playlist, loading } = this.state;
    const { APIService, spotifyAuth } = this.context;

    const { track: tracks } = playlist;
    const hasRightToEdit = this.hasRightToEdit();
    const { currentUser } = this.context;

    const showSpotifyExportButton = spotifyAuth?.permission?.includes(
      "playlist-modify-public"
    );

    const customFields = getPlaylistExtension(playlist);

    return (
      <div role="main">
        <Loader
          isLoading={loading}
          loaderText="Exporting playlist…"
          className="full-page-loader"
        />
        <div className="row">
          <div id="playlist" className="col-md-8 col-md-offset-2">
            <div className="playlist-details row">
              <h1 className="title">
                <div>
                  {playlist.title}
                  <span className="dropdown pull-right">
                    <button
                      className="btn btn-info dropdown-toggle"
                      type="button"
                      id="playlistOptionsDropdown"
                      data-toggle="dropdown"
                      aria-haspopup="true"
                      aria-expanded="true"
                    >
                      <FontAwesomeIcon
                        icon={faCog as IconProp}
                        title="Options"
                      />
                      &nbsp;Options
                    </button>
                    <PlaylistMenu playlist={playlist} />
                  </span>
                </div>
                <small>
                  {customFields?.public ? "Public " : "Private "}
                  playlist by{" "}
                  <a href={sanitizeUrl(`/user/${playlist.creator}/playlists`)}>
                    {playlist.creator}
                  </a>
                </small>
              </h1>
              <div className="info">
                <div>{playlist.track?.length} tracks</div>
                <div>Created: {new Date(playlist.date).toLocaleString()}</div>
                {customFields?.collaborators &&
                  Boolean(customFields.collaborators.length) && (
                    <div>
                      With the help of:&ensp;
                      {customFields.collaborators.map((collaborator, index) => (
                        <React.Fragment key={collaborator}>
                          <a href={sanitizeUrl(`/user/${collaborator}`)}>
                            {collaborator}
                          </a>
                          {index <
                          (customFields?.collaborators?.length ?? 0) - 1
                            ? ", "
                            : ""}
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                {customFields?.last_modified_at && (
                  <div>
                    Last modified:{" "}
                    {new Date(customFields.last_modified_at).toLocaleString()}
                  </div>
                )}
                {customFields?.copied_from && (
                  <div>
                    Copied from:
                    <a href={sanitizeUrl(customFields.copied_from)}>
                      {customFields.copied_from.substr(
                        PLAYLIST_URI_PREFIX.length
                      )}
                    </a>
                  </div>
                )}
              </div>
              {playlist.annotation && (
                <div
                  // Sanitize the HTML string before passing it to dangerouslySetInnerHTML
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={{
                    __html: sanitize(playlist.annotation),
                  }}
                />
              )}
              <hr />
            </div>
            {hasRightToEdit && tracks.length > 10 && (
              <div className="text-center">
                <a
                  className="btn btn-primary"
                  type="button"
                  href="#add-track"
                  style={{ marginBottom: "1em" }}
                >
                  <FontAwesomeIcon icon={faPlusCircle as IconProp} />
                  &nbsp;&nbsp;Add a track
                </a>
              </div>
            )}
            <div id="listens row">
              {tracks.length > 0 ? (
                <ReactSortable
                  handle=".drag-handle"
                  list={tracks as (JSPFTrack & { id: string })[]}
                  onEnd={this.movePlaylistItem}
                  setList={(newState) =>
                    this.setState({
                      playlist: { ...playlist, track: newState },
                    })
                  }
                >
                  {tracks.map((track: JSPFTrack, index) => {
                    return (
                      <PlaylistItemCard
                        key={`${track.id}-${index.toString()}`}
                        canEdit={hasRightToEdit}
                        track={track}
                        removeTrackFromPlaylist={this.deletePlaylistItem}
                      />
                    );
                  })}
                </ReactSortable>
              ) : (
                <div className="lead text-center">
                  <p>Nothing in this playlist yet</p>
                </div>
              )}
              {hasRightToEdit && (
                <Card className="listen-card row" id="add-track">
                  <span>
                    <FontAwesomeIcon icon={faPlusCircle as IconProp} />
                    &nbsp;&nbsp;Add a track
                  </span>
                  <SearchTrackOrMBID onSelectRecording={this.addTrack} />
                </Card>
              )}
            </div>
            {isPlaylistOwner(playlist, currentUser) && (
              <>
                <CreateOrEditPlaylistModal
                  onSubmit={this.editPlaylist}
                  playlist={playlist}
                />
                <DeletePlaylistConfirmationModal
                  onConfirm={this.deletePlaylist}
                  playlist={playlist}
                />
              </>
            )}
          </div>
          <BrainzPlayer
            listens={tracks.map(JSPFTrackToListen)}
            listenBrainzAPIBaseURI={APIService.APIBaseURI}
            refreshSpotifyToken={APIService.refreshSpotifyToken}
            refreshYoutubeToken={APIService.refreshYoutubeToken}
            refreshSoundcloudToken={APIService.refreshSoundcloudToken}
          />
        </div>
      </div>
    );
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const {
    domContainer,
    reactProps,
    globalAppContext,
    sentryProps,
  } = getPageProps();
  const { sentry_dsn, sentry_traces_sample_rate } = sentryProps;

  if (sentry_dsn) {
    Sentry.init({
      dsn: sentry_dsn,
      integrations: [new Integrations.BrowserTracing()],
      tracesSampleRate: sentry_traces_sample_rate,
    });
  }
  const { playlist } = reactProps;

  const PlaylistPageWithAlertNotifications = withAlertNotifications(
    PlaylistPage
  );

  const renderRoot = createRoot(domContainer!);
  renderRoot.render(
    <ErrorBoundary>
      <GlobalAppContext.Provider value={globalAppContext}>
        <NiceModal.Provider>
          <PlaylistPageWithAlertNotifications playlist={playlist} />
        </NiceModal.Provider>
      </GlobalAppContext.Provider>
    </ErrorBoundary>
  );
});
