import NiceModal, { useModal } from "@ebay/nice-modal-react";
import {
  faArrowRightLong,
  faInfoCircle,
  faQuestionCircle,
  faTimesCircle,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import * as React from "react";
import { toast } from "react-toastify";
import Tooltip from "react-tooltip";
import Fuse from "fuse.js";
import { omit, size, uniq } from "lodash";
import ListenCard from "../../common/listens/ListenCard";
import { ToastMsg } from "../../notifications/Notifications";
import GlobalAppContext from "../../utils/GlobalAppContext";
import SearchAlbumOrMBID from "../../utils/SearchAlbumOrMBID";
import {
  getListenFromTrack,
  MBTrackWithAC,
} from "../../user/components/AddListenModal";
import { MBReleaseWithMetadata } from "../../user/components/AddAlbumListens";
import ListenControl from "../../common/listens/ListenControl";

type MatchingTracksResult = MBTrackWithAC & {
  searchString: string;
};

export type MatchingTracksResults = {
  [recording_msid: string]: MatchingTracksResult;
};

export type MultiTrackMBIDMappingModalProps = {
  releaseName: string | null;
  missingData: Array<MissingMBData>;
};

export default NiceModal.create(
  ({ missingData, releaseName }: MultiTrackMBIDMappingModalProps) => {
    const modal = useModal();
    const { APIService, currentUser } = React.useContext(GlobalAppContext);
    const { lookupMBRelease } = APIService;
    const { auth_token } = currentUser;

    const { resolve, visible } = modal;

    const [matchingTracks, setMatchingTracks] = React.useState<
      MatchingTracksResults
    >();
    const [includeArtistName, setIncludeArtistName] = React.useState(false);
    const [selectedAlbumMBID, setSelectedAlbumMBID] = React.useState<string>();
    const [selectedAlbum, setSelectedAlbum] = React.useState<
      MBReleaseWithMetadata
    >();
    const [potentialTracks, setPotentialTracks] = React.useState<
      MBTrackWithAC[]
    >();

    const closeModal = React.useCallback(() => {
      modal.hide();
      document?.body?.classList?.remove("modal-open");
      // Need to manually remove the modal backdrop
      const backdrop = document?.body?.getElementsByClassName(
        "modal-backdrop"
      )?.[0];
      backdrop?.parentElement?.removeChild(backdrop);
      setTimeout(modal.remove, 200);
    }, [modal]);

    React.useEffect(() => {
      const closeOnEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          closeModal();
        }
      };
      window.addEventListener("keydown", closeOnEscape);
      return () => window.removeEventListener("keydown", closeOnEscape);
    }, [closeModal]);

    const handleError = React.useCallback(
      (error: string | Error, title?: string): void => {
        if (!error) {
          return;
        }
        toast.error(
          <ToastMsg
            title={title || "Error"}
            message={typeof error === "object" ? error.message : error}
          />,
          { toastId: "linked-track-error" }
        );
      },
      []
    );

    const submitMBIDMapping = React.useCallback(
      async (event: React.FormEvent) => {
        event.preventDefault();

        if (!matchingTracks || !size(matchingTracks) || !auth_token) {
          return;
        }
        const promises: Promise<{ status: string }>[] = [];
        const entries = Object.entries(matchingTracks);
        // eslint-disable-next-line no-restricted-syntax
        for (const [recordingMSID, trackMetadata] of entries) {
          const recordingMBID = trackMetadata.recording.id;
          if (recordingMBID) {
            promises.push(
              APIService.submitMBIDMapping(
                auth_token,
                recordingMSID,
                recordingMBID
              )
            );
          }
        }
        try {
          const results = await Promise.allSettled(promises);
          const successfulMappings: Array<{
            recordingMSID: string;
            track: MatchingTracksResult;
            response: PromiseFulfilledResult<{ status: string }>;
          }> = [];
          const failedMappings: Array<{
            recordingMSID: string;
            track: MatchingTracksResult;
            response: PromiseRejectedResult;
          }> = [];
          // Iterating with a forEach instead of for example using lodash groupBy
          // so we can use the index, preserved by Promise.allSettled,
          // to get the track name for display purposes
          results.forEach((res, idx) => {
            const recordingMSID = entries[idx][0];
            const trackMetadata: MatchingTracksResult = entries[idx][1];
            if (res.status === "fulfilled") {
              successfulMappings.push({
                recordingMSID,
                track: trackMetadata,
                response: res,
              });
            } else {
              failedMappings.push({
                recordingMSID,
                track: trackMetadata,
                response: res,
              });
            }
          });
          if (failedMappings.length) {
            const failureList = (
              <div>
                <ul className="list-group list-group-item-danger list-group-item-text">
                  {failedMappings.map((item) => (
                    <li>{item.track.title}</li>
                  ))}
                </ul>
                With the following errors:
                <br />
                {uniq(
                  failedMappings.map((f) => f.response.reason.toString())
                ).join(`\n`)}
              </div>
            );
            toast.error(
              <ToastMsg
                title={`Failed to link ${failedMappings.length} tracks:`}
                message={failureList}
              />,
              {
                toastId: "failed-linked-track",
                type: "error",
              }
            );
          }

          if (successfulMappings.length) {
            const successList = (
              <ul className="list-group list-group-item-success list-group-item-text">
                {successfulMappings.map((item) => (
                  <li>{item.track.title}</li>
                ))}
              </ul>
            );
            toast.success(
              <ToastMsg
                title={`You linked ${successfulMappings.length} tracks!`}
                message={successList}
              />,
              {
                toastId: "linked-track",
              }
            );
            const returnValue: MatchingTracksResults = {};
            successfulMappings.forEach(({ recordingMSID, track }) => {
              returnValue[recordingMSID] = track;
            });
            resolve(returnValue);
          }

          closeModal();
        } catch (error) {
          handleError(error, "Error while linking listens");
        }
      },
      [auth_token, closeModal, resolve, APIService, matchingTracks, handleError]
    );

    React.useEffect(() => {
      async function fetchTrackList(releaseMBID: string) {
        // Fetch the tracklist fron MusicBrainz
        try {
          const fetchedRelease = (await lookupMBRelease(
            releaseMBID,
            "recordings+artist-credits+release-groups"
          )) as MBReleaseWithMetadata;
          setSelectedAlbum(fetchedRelease);
          const newSelection = fetchedRelease.media
            .map(({ tracks }) => tracks as MBTrackWithAC[])
            .flat();
          setPotentialTracks(newSelection);
        } catch (error) {
          toast.error(`Could not load track list for ${releaseMBID}`);
        }
      }
      if (!selectedAlbumMBID) {
        setSelectedAlbum(undefined);
        setPotentialTracks([]);
        setMatchingTracks({});
      } else {
        fetchTrackList(selectedAlbumMBID);
      }
    }, [selectedAlbumMBID, lookupMBRelease]);

    React.useEffect(() => {
      if (!potentialTracks?.length) {
        return;
      }
      // Once we select an album and fetch the tracklist, we want to
      // automatically match listens to their corresponding track
      const fuzzysearch = new Fuse(potentialTracks, {
        keys: ["title", "artist-credit.name"],
      });
      const newMatchingTracks: MatchingTracksResults = {};
      missingData.forEach((missingDataItem) => {
        let stringToSearch = missingDataItem.recording_name;
        if (includeArtistName) {
          stringToSearch += ` ${missingDataItem.artist_name}`;
        }
        const matches = fuzzysearch.search(stringToSearch);
        if (matches[0]) {
          // We have a match
          newMatchingTracks[missingDataItem.recording_msid] = {
            ...matches[0].item,
            searchString: stringToSearch,
          };
        } else {
          // eslint-disable-next-line no-console
          console.debug("Couldn't find a match for", stringToSearch);
        }
      });
      setMatchingTracks(newMatchingTracks);
    }, [includeArtistName, missingData, potentialTracks]);

    const removeItemFromMatches = (recordingMSID: string) => {
      setMatchingTracks((currentMatchingTracks) =>
        omit(currentMatchingTracks, recordingMSID)
      );
    };

    if (!missingData) {
      return null;
    }
    const matchingTracksEntries =
      matchingTracks && Object.entries(matchingTracks);
    const hasMatches = Boolean(matchingTracksEntries?.length);
    const unmatchedItems =
      missingData.filter((md) => !matchingTracks?.[md.recording_msid]) ?? [];

    return (
      <div
        className={`modal fade ${visible ? "in" : ""}`}
        id="MultiTrackMBIDMappingModal"
        role="dialog"
        aria-labelledby="MultiTrackMBIDMappingModalLabel"
        data-backdrop
        data-keyboard
      >
        <div className="modal-dialog" role="document">
          <Tooltip id="musicbrainz-helptext" type="info" multiline>
            Search for an album matching the tracks above.
            <br />
            Alternatively, you can search for a release or release-group using
            the MusicBrainz search (musicbrainz.org/search).
            <br />
            When you have found the one that matches your listens, copy its URL
            (link) into the search box above.
          </Tooltip>
          <form className="modal-content" onSubmit={submitMBIDMapping}>
            <div className="modal-header">
              <button
                type="button"
                className="close"
                onClick={closeModal}
                aria-label="Close"
              >
                <span aria-hidden="true">&times;</span>
              </button>
              <h4 className="modal-title" id="MultiTrackMBIDMappingModalLabel">
                Link listens
              </h4>
            </div>
            <div className="modal-body">
              <div>
                <p className="small help-block text-left">
                  Search by album/artist name or paste a{" "}
                  <a href="https://musicbrainz.org/doc/About">
                    MusicBrainz URL or MBID
                  </a>
                  .
                  <FontAwesomeIcon
                    icon={faQuestionCircle}
                    data-tip
                    data-for="musicbrainz-helptext"
                    size="sm"
                  />
                </p>
                <div className="card listen-card">
                  <SearchAlbumOrMBID
                    onSelectAlbum={setSelectedAlbumMBID}
                    defaultValue={`${releaseName} ${
                      missingData[0].artist_name ? `artist:${missingData[0].artist_name}`: ""
                    }`}
                  />
                </div>
                <div className="form-check mt-15">
                  <input
                    className="form-check-input"
                    id="includeArtist"
                    type="checkbox"
                    checked={includeArtistName}
                    onChange={(e) => setIncludeArtistName(e.target.checked)}
                  />
                  &nbsp;
                  <label
                    htmlFor="includeArtist"
                    style={{ fontWeight: "initial" }}
                  >
                    Include artist name when matching{" "}
                    <FontAwesomeIcon
                      icon={faQuestionCircle}
                      data-tip
                      data-for="includeArtistNameHelp"
                      size="sm"
                    />{" "}
                  </label>
                </div>
                <Tooltip id="includeArtistNameHelp" type="info" multiline>
                  Depending on the data we have available, including the artist
                  name can result in worse matching. Tick this checkbox if you
                  have a poor matching rate.
                </Tooltip>
              </div>
              <hr />
              {selectedAlbum && (
                <div className="header-with-line">
                  <a
                    href={`https://musicbrainz.org/release/${selectedAlbum.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <strong>{selectedAlbum.title}</strong>
                  </a>
                  {selectedAlbum.date && (
                    <span>
                      &nbsp;({new Date(selectedAlbum.date).getFullYear()})
                    </span>
                  )}
                  &nbsp;–&nbsp;
                  {selectedAlbum["artist-credit"]
                    ?.map((artist) => `${artist.name}${artist.joinphrase}`)
                    .join("")}
                  {selectedAlbum["release-group"]?.["primary-type"] && (
                    <small>
                      &nbsp;(
                      {selectedAlbum["release-group"]?.["primary-type"]})
                    </small>
                  )}
                </div>
              )}
              {hasMatches && matchingTracksEntries && (
                <h5>
                  Found {matchingTracksEntries.length} matches. Please check
                  each listen below:
                </h5>
              )}

              {hasMatches && matchingTracksEntries && (
                <div className="mt-15">
                  {matchingTracksEntries.map(([recordingMSID, track]) => {
                    return (
                      <div
                        key={recordingMSID}
                        className="flex"
                        style={{ alignItems: "center" }}
                      >
                        <q>{track.searchString}</q>
                        <FontAwesomeIcon
                          icon={faArrowRightLong}
                          style={{ flex: "0 1 50px" }}
                        />
                        <div style={{ flex: "2 1 0%" }}>
                          <ListenCard
                            key={recordingMSID}
                            compact
                            listen={getListenFromTrack(
                              track,
                              new Date(0),
                              selectedAlbum
                            )}
                            showTimestamp={false}
                            showUsername={false}
                            // eslint-disable-next-line react/jsx-no-useless-fragment
                            feedbackComponent={<></>}
                            additionalActions={
                              <ListenControl
                                buttonClassName="btn-transparent"
                                text=""
                                title="Remove incorrect match"
                                icon={faTimesCircle}
                                iconSize="lg"
                                action={() =>
                                  removeItemFromMatches(recordingMSID)
                                }
                              />
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {unmatchedItems && Boolean(unmatchedItems.length) && (
                <>
                  {selectedAlbum ? (
                    <>
                      <h5>Unlinked items</h5>
                      We could not automatically find a match for the following
                      listens:
                    </>
                  ) : (
                    <h5>Listens to link</h5>
                  )}
                  <ul style={{ fontSize: "smaller" }}>
                    {unmatchedItems.map((unmatched) => (
                      <li key={unmatched.recording_name}>
                        {[unmatched.recording_name, unmatched.artist_name].join(
                          " - "
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-default"
                onClick={closeModal}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-success"
                disabled={!hasMatches}
              >
                Link listens
              </button>
              <div className="small help-block text-left">
                <div>
                  <FontAwesomeIcon icon={faInfoCircle} />
                  &nbsp;
                  <a
                    href="https://listenbrainz.readthedocs.io/en/latest/general/data-update-intervals.html#user-statistics"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    How long until my stats reflect the change?
                  </a>
                </div>
                <div>
                  <FontAwesomeIcon icon={faInfoCircle} />
                  &nbsp;
                  <a
                    href="https://listenbrainz.readthedocs.io/en/latest/general/data-update-intervals.html#mbid-mapper-musicbrainz-metadata-cache"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Releases added to MusicBrainz within the last 4 hours may
                    temporarily look incomplete.
                  </a>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    );
  }
);
